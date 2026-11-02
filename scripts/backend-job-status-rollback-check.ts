import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ContractSchema, LedgerSchema } from "../src/domain/model";
import { saveContractChange } from "../src/domain/contracts";
import { legacyJobStatusLedger } from "../src/domain/testing/legacyJobStatus";

const container = "supabase_db_bari-khata";
const endpoint = JSON.parse(
  execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }),
)[0].Endpoints.docker.Host;
assert.match(
  process.env.DOCKER_HOST ?? endpoint,
  /^unix:\/\//,
  "Only a local Docker socket may be used.",
);
assert.match(
  execFileSync(
    "docker",
    ["inspect", container, "--format", "{{.Config.Image}}"],
    { encoding: "utf8" },
  ).trim(),
  /supabase\/postgres:/,
);
function db(sql: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { input: sql, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  ).trim();
}
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const signatures = [
  "public.contract_terms(jsonb)",
  "public.contract_snapshot_is_valid(jsonb,jsonb)",
  "public.contract_activity_for_comparison(jsonb)",
  "public.ledger_evolution_is_valid(jsonb,jsonb)",
  "public.ledger_contracts_are_valid(jsonb)",
];
const fingerprint = () =>
  db(
    `select jsonb_object_agg(name,coalesce(md5(pg_get_functiondef(to_regprocedure(name))),'absent')) from unnest(array[${signatures.map(quote).join(",")}]) name;`,
  );
const constraintState = () =>
  db(
    "select coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname='ledger_contracts_valid' and conrelid='public.ledger_documents'::regclass),'absent');",
  );
const original = fingerprint();
const originalConstraint = constraintState();
assert.notEqual(
  originalConstraint,
  "absent",
  "Apply the earlier local contract schema before testing job status.",
);
const installed =
  db(
    "select to_regprocedure('public.contract_activity_for_comparison(jsonb)') is not null;",
  ) === "t";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611020005_job_progress_status.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const raw = legacyJobStatusLedger();
const normalized = LedgerSchema.parse(raw);
const updated = saveContractChange(
  normalized,
  ContractSchema.parse({ ...normalized.contracts[0], status: "done" }),
  "Synthetic work completed",
  "2026-11-02T00:00:00Z",
);
const invalidStatus = {
  ...updated,
  contracts: updated.contracts.map((contract) => ({
    ...contract,
    status: "finished",
    activity: contract.activity.map((event) => ({
      ...event,
      after: { ...event.after, status: "finished" },
    })),
  })),
};
const unlogged = LedgerSchema.parse({
  ...normalized,
  contracts: normalized.contracts.map((contract) => ({
    ...contract,
    activity: [],
  })),
});
const unaudited = {
  ...unlogged,
  contracts: unlogged.contracts.map((contract) => ({
    ...contract,
    status: "done",
  })),
};
const firstDone = saveContractChange(
  unlogged,
  ContractSchema.parse({ ...unlogged.contracts[0], status: "done" }),
  "Synthetic first status",
  "2026-11-02T00:00:00Z",
);
const wrongBefore = structuredClone(firstDone);
wrongBefore.contracts[0].activity[0].before!.status = "planned";
const changedPrefix = structuredClone(updated);
changedPrefix.contracts[0].activity[0].before!.status = "planned";
const financialPrefix = structuredClone(updated);
financialPrefix.contracts[0].activity[0].before!.total = 1;
const rateLedger = saveContractChange(
  LedgerSchema.parse({ works: normalized.works, people: normalized.people }),
  ContractSchema.parse({
    id: "rate-job",
    personId: "worker",
    scope: "house",
    status: "ongoing",
    basis: "day",
    quantity: "2",
    rate: 10000,
    total: 20000,
  }),
);
const wrongRate = structuredClone(rateLedger);
wrongRate.contracts[0].total = 30000;
wrongRate.contracts[0].activity[0].after.total = 30000;
const owner = randomUUID();
const unloggedOwner = randomUUID();
const ids = [owner, unloggedOwner].map((id) => `${quote(id)}::uuid`).join(",");
const chunks = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s'; set local idle_in_transaction_session_timeout='30s';",
  ...(installed ? [] : [migration]),
];
for (const [id, document] of [
  [owner, raw],
  [unloggedOwner, unlogged],
] as const) {
  chunks.push(
    `insert into auth.users(id,aud,role,email) values (${quote(id)}::uuid,'authenticated','authenticated',${quote(`status-rollback-${id}@example.invalid`)});`,
  );
  chunks.push(
    `insert into public.ledger_documents(owner_id,revision,document) values (${quote(id)}::uuid,1,${json(document)});`,
  );
}
chunks.push(
  `update public.ledger_documents set document=${json(normalized)} where owner_id=${quote(owner)}::uuid;`,
);
chunks.push(
  `update public.ledger_documents set document=${json(raw)} where owner_id=${quote(owner)}::uuid;`,
);
chunks.push(
  `update public.ledger_documents set document=${json(updated)} where owner_id=${quote(owner)}::uuid;`,
);
chunks.push(`do $status_guards$
declare rejected boolean:=false; actual jsonb;
begin
  if public.contract_terms(${json(raw.contracts[0])})->'status' is distinct from 'null'::jsonb then raise exception 'legacy_status_not_unknown'; end if;
  if not public.ledger_contracts_are_valid(${json(normalized)}) then raise exception 'null_status_normalization_rejected'; end if;
  if public.ledger_contracts_are_valid(${json(invalidStatus)}) then raise exception 'invalid_status_accepted'; end if;
  if not public.ledger_contracts_are_valid(${json(unaudited)}) then raise exception 'unaudited_fixture_not_independently_valid'; end if;
  if public.ledger_evolution_is_valid(${json(unlogged)},${json(unaudited)}) then raise exception 'status_changed_without_audit'; end if;
  if not public.ledger_contracts_are_valid(${json(wrongBefore)}) then raise exception 'wrong_before_fixture_not_independently_valid'; end if;
  if public.ledger_evolution_is_valid(${json(unlogged)},${json(wrongBefore)}) then raise exception 'invented_previous_status_accepted'; end if;
  if public.ledger_evolution_is_valid(${json(raw)},${json(changedPrefix)}) then raise exception 'actual_old_status_rewritten'; end if;
  if public.ledger_evolution_is_valid(${json(raw)},${json(financialPrefix)}) then raise exception 'old_financial_history_rewritten'; end if;
  if public.ledger_contracts_are_valid(${json(wrongRate)}) then raise exception 'computed_financial_guard_lost'; end if;
  if not public.ledger_contracts_are_valid(${json(rateLedger)}) then raise exception 'explicit_ongoing_creation_rejected'; end if;
  select document into actual from public.ledger_documents where owner_id=${quote(owner)}::uuid;
  if actual#>>'{contracts,0,status}'<>'done' then raise exception 'audited_status_not_saved'; end if;
  if actual->'entries' is distinct from ${json(raw.entries)} then raise exception 'status_change_altered_transactions'; end if;
  if (public.contract_terms(actual#>'{contracts,0}')-'status') is distinct from (public.contract_terms(${json(raw.contracts[0])})-'status') then raise exception 'status_change_altered_terms'; end if;
  if actual#>'{contracts,0,history}' is distinct from ${json(raw.contracts[0].history)} then raise exception 'legacy_history_changed'; end if;
  begin
    update public.ledger_documents set document=${json(unaudited)} where owner_id=${quote(unloggedOwner)}::uuid;
  exception when others then
    if sqlerrm='ledger_history_would_be_lost' then rejected:=true; else raise; end if;
  end;
  if not rejected then raise exception 'unaudited_status_update_committed'; end if;
  rejected:=false;
  begin
    update public.ledger_documents set document=${json(changedPrefix)} where owner_id=${quote(owner)}::uuid;
  exception when others then
    if sqlerrm='ledger_history_would_be_lost' then rejected:=true; else raise; end if;
  end;
  if not rejected then raise exception 'rewritten_status_history_update_committed'; end if;
end;
$status_guards$;
select 'job_status_rollback_passed'; rollback;`);
try {
  assert.equal(db(chunks.join("\n")), "job_status_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    original,
    "The original function definitions must be unchanged.",
  );
  assert.equal(
    constraintState(),
    originalConstraint,
    "The existing financial constraint must be unchanged.",
  );
  assert.equal(
    db(
      `select not exists(select 1 from auth.users where id in (${ids})) and not exists(select 1 from public.ledger_documents where owner_id in (${ids})) and not exists(select 1 from public.contact_share_links where owner_id in (${ids}));`,
    ),
    "t",
    "All synthetic fixtures must roll back.",
  );
}
console.log(
  `Local Supabase job status: null/absent legacy audit normalization, audited status, invalid status, immutable status/financial history and full rollback verified (${installed ? "existing schema" : "temporary migration"}).`,
);

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { LedgerSchema } from "../src/domain/model";
import { setEntityRemoved } from "../src/domain/entityDeletion";

const container = "supabase_db_bari-khata";
const endpoint = JSON.parse(
  execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }),
)[0].Endpoints.docker.Host;
assert.match(process.env.DOCKER_HOST ?? endpoint, /^unix:\/\//);
assert.match(
  execFileSync(
    "docker",
    ["inspect", container, "--format", "{{.Config.Image}}"],
    { encoding: "utf8" },
  ),
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
const fingerprint = () =>
  db(
    "select jsonb_build_object('evolution',md5(pg_get_functiondef('public.ledger_evolution_is_valid(jsonb,jsonb)'::regprocedure)),'removal',coalesce(md5(pg_get_functiondef(to_regprocedure('public.ledger_removals_are_valid(jsonb)'))),'absent'),'constraint',coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname='ledger_removals_valid' and conrelid='public.ledger_documents'::regclass),'absent'));",
  );
const original = fingerprint();
const installed =
  db(
    "select to_regprocedure('public.ledger_removals_are_valid(jsonb)') is not null;",
  ) === "t";
assert.equal(
  db(
    "select to_regprocedure('public.contract_activity_for_comparison(jsonb)') is not null;",
  ),
  "t",
  "Apply local job status migration first.",
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611020006_reversible_entity_removal.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const initial = LedgerSchema.parse({
  works: [{ id: "door", name: "Synthetic doors" }],
  people: [{ id: "worker", name: "Synthetic worker", kind: "worker" }],
  contracts: [
    {
      id: "job",
      personId: "worker",
      workId: "door",
      title: "Synthetic work",
      total: 200000,
    },
  ],
  entries: [
    {
      id: "paid",
      kind: "payment",
      personId: "worker",
      account: "labour",
      contractId: "job",
      allocations: [{ workId: "door", amount: 100000 }],
      paymentParts: [{ amount: 100000 }],
    },
  ],
});
const legacy = structuredClone(initial) as unknown as Record<string, unknown[]>;
for (const key of ["works", "people", "contracts"])
  for (const record of legacy[key] as Record<string, unknown>[]) {
    delete record.archivedAt;
    delete record.removalHistory;
  }
let removed = initial;
let restored = initial;
for (const [kind, id] of [
  ["work", "door"],
  ["person", "worker"],
  ["contract", "job"],
] as const)
  removed = setEntityRemoved(
    removed,
    kind,
    id,
    true,
    undefined,
    "2026-11-02T00:00:00Z",
  );
restored = removed;
for (const [kind, id] of [
  ["work", "door"],
  ["person", "worker"],
  ["contract", "job"],
] as const)
  restored = setEntityRemoved(
    restored,
    kind,
    id,
    false,
    undefined,
    "2026-11-02T01:00:00Z",
  );
const wrongState = structuredClone(removed);
wrongState.people[0].archivedAt = null;
const rewritten = structuredClone(restored);
rewritten.contracts[0].removalHistory[0].id = "rewritten";
const unaudited = structuredClone(initial);
unaudited.works[0].archivedAt = "2026-11-02T00:00:00Z";
const owner = randomUUID();
const sql = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s';",
  ...(installed ? [] : [migration]),
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`removal-${owner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(legacy)});`,
  `update public.ledger_documents set document=${json(initial)} where owner_id=${quote(owner)}::uuid;`,
  `update public.ledger_documents set document=${json(removed)} where owner_id=${quote(owner)}::uuid;`,
  `update public.ledger_documents set document=${json(restored)} where owner_id=${quote(owner)}::uuid;`,
  `do $removal_checks$ declare rejected boolean:=false; actual jsonb; begin
    if not public.ledger_removals_are_valid(${json(legacy)}) then raise exception 'legacy_not_accepted'; end if;
    if not public.ledger_removals_are_valid(${json(removed)}) or not public.ledger_removals_are_valid(${json(restored)}) then raise exception 'archive_or_restore_rejected'; end if;
    if public.ledger_removals_are_valid(${json(wrongState)}) or public.ledger_removals_are_valid(${json(unaudited)}) then raise exception 'unaudited_state_accepted'; end if;
    if public.ledger_evolution_is_valid(${json(removed)},${json(initial)}) or public.ledger_evolution_is_valid(${json(removed)},${json(legacy)}) then raise exception 'old_copy_silently_revived_items'; end if;
    if public.ledger_evolution_is_valid(${json(removed)},${json(rewritten)}) then raise exception 'removal_history_rewritten'; end if;
    select document into actual from public.ledger_documents where owner_id=${quote(owner)}::uuid;
    if actual->'entries' is distinct from ${json(initial.entries)} then raise exception 'transactions_changed'; end if;
    if actual#>'{contracts,0,total}' is distinct from ${json(initial.contracts[0].total)} then raise exception 'money_changed'; end if;
    begin update public.ledger_documents set document=${json(initial)} where owner_id=${quote(owner)}::uuid;
    exception when others then if sqlerrm='ledger_history_would_be_lost' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'history_losing_update_committed'; end if;
  end; $removal_checks$;
  select 'removal_rollback_passed'; rollback;`,
].join("\n");
try {
  assert.equal(db(sql), "removal_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    original,
    "Local function/constraint state must roll back.",
  );
  assert.equal(
    db(
      `select not exists(select 1 from auth.users where id=${quote(owner)}::uuid) and not exists(select 1 from public.ledger_documents where owner_id=${quote(owner)}::uuid);`,
    ),
    "t",
    "All synthetic fixtures must roll back.",
  );
}
console.log(
  `Local Supabase reversible removal: archive/restore, legacy data, immutable history, unchanged money and rollback verified (${installed ? "existing schema" : "temporary migration"}).`,
);

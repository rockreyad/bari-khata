import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ContractSchema, LedgerSchema } from "../src/domain/model";
import { saveContractChange } from "../src/domain/contracts";

const container = "supabase_db_bari-khata";
const dockerHost = JSON.parse(
  execFileSync("docker", ["context", "inspect"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
)[0].Endpoints.docker.Host;
assert.match(
  process.env.DOCKER_HOST ?? dockerHost,
  /^unix:\/\//,
  "Only a local Docker socket may be used.",
);
assert.match(
  execFileSync(
    "docker",
    ["inspect", container, "--format", "{{.Config.Image}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim(),
  /supabase\/postgres:/,
  "Only the local Bari Khata database may be used.",
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
    {
      input: sql,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const signatures = [
  "public.contract_terms(jsonb)",
  "public.contract_snapshot_is_valid(jsonb,jsonb)",
  "public.ledger_contracts_are_valid(jsonb)",
  "public.contract_activity_for_comparison(jsonb)",
];
const fingerprint = () =>
  db(
    `select jsonb_object_agg(name,md5(pg_get_functiondef(to_regprocedure(name)))) from unnest(array[${signatures.map(quote).join(",")}]) name;`,
  );
const before = fingerprint();
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611030002_contract_agreed_totals.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const legacy = saveContractChange(
  LedgerSchema.parse({
    works: [{ id: "work", name: "Synthetic work" }],
    people: [{ id: "worker", name: "Synthetic worker", kind: "worker" }],
  }),
  ContractSchema.parse({
    id: "agreement",
    workId: "work",
    personId: "worker",
    basis: "sqft",
    quantity: "3796",
    rate: 2300,
    total: 8730800,
  }),
  "Synthetic original agreement",
  "2026-11-01T03:00:00Z",
);
const calculated = saveContractChange(
  legacy,
  { ...legacy.contracts[0], calculatedTotal: 8730800 },
  "Synthetic explicit calculation",
  "2026-11-02T03:00:00Z",
);
const negotiated = saveContractChange(
  calculated,
  { ...calculated.contracts[0], total: 8700000 },
  "Synthetic agreed amount",
  "2026-11-03T03:00:00Z",
);
const revised = saveContractChange(
  negotiated,
  { ...negotiated.contracts[0], total: 8500000 },
  "Synthetic revised agreement",
  "2026-11-04T03:00:00Z",
);
const stripped = JSON.parse(JSON.stringify(calculated), (key, value) =>
  key === "calculatedTotal" ? undefined : value,
);
const normalized = JSON.parse(JSON.stringify(legacy));
normalized.contracts[0].calculatedTotal = null;
normalized.contracts[0].activity[0].after.calculatedTotal = null;
const malformed = JSON.parse(JSON.stringify(revised));
malformed.contracts[0].calculatedTotal = 8730801;
malformed.contracts[0].activity.at(-1).after.calculatedTotal = 8730801;
const removedCalculation = JSON.parse(
  JSON.stringify(negotiated),
  (key, value) => (key === "calculatedTotal" ? undefined : value),
);
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const owner = randomUUID();
const update = (value: unknown) =>
  `update public.ledger_documents set document=${json(value)} where owner_id=${quote(owner)}::uuid;`;
const statements = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s'; set local idle_in_transaction_session_timeout='30s';",
  migration,
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`agreed-total-${owner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(legacy)});`,
  update(calculated),
  `do $old_client$ declare rejected boolean:=false; begin
    if not public.ledger_contracts_are_valid(${json(stripped)}) then raise exception 'old_client_fixture_is_not_independently_valid'; end if;
    if public.ledger_evolution_is_valid(${json(calculated)},${json(stripped)}) then raise exception 'calculation_history_loss_accepted'; end if;
    begin ${update(stripped)} exception when others then
      if sqlerrm='ledger_history_would_be_lost' then rejected:=true; else raise; end if;
    end;
    if not rejected then raise exception 'old_client_update_was_accepted'; end if;
  end; $old_client$;`,
  update(negotiated),
  update(revised),
  `do $agreed_guards$ begin
    if not public.ledger_contracts_are_valid(${json(revised)}) then raise exception 'agreed_total_rejected'; end if;
    if public.ledger_contracts_are_valid(${json(malformed)}) then raise exception 'fabricated_calculation_accepted'; end if;
    if public.ledger_contracts_are_valid(${json(removedCalculation)}) then raise exception 'negotiated_history_without_calculation_accepted'; end if;
    if not public.ledger_evolution_is_valid(${json(legacy)},${json(normalized)}) then raise exception 'legacy_null_compatibility_broken'; end if;
    if (select document#>>'{contracts,0,total}' from public.ledger_documents where owner_id=${quote(owner)}::uuid) <> '8500000' then raise exception 'agreed_amount_not_saved'; end if;
    if (select document#>>'{contracts,0,calculatedTotal}' from public.ledger_documents where owner_id=${quote(owner)}::uuid) <> '8730800' then raise exception 'calculated_amount_not_saved'; end if;
  end; $agreed_guards$;`,
  "select 'agreed_total_rollback_passed'; rollback;",
];
try {
  assert.equal(db(statements.join("\n")), "agreed_total_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    before,
    "All temporarily replaced functions must be rolled back.",
  );
  assert.equal(
    db(
      `select not exists(select 1 from auth.users where id=${quote(owner)}::uuid) and not exists(select 1 from public.ledger_documents where owner_id=${quote(owner)}::uuid);`,
    ),
    "t",
    "Disposable fixtures must be rolled back.",
  );
}
console.log(
  "Local Supabase: calculated/agreed totals, audited corrections, old-client history protection, legacy compatibility and full rollback verified.",
);

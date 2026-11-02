import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { contactAccountSummary } from "../src/domain/contacts";
import { ContractSchema, LedgerSchema } from "../src/domain/model";
import { saveContractChange } from "../src/domain/contracts";
import { contractSummary } from "../src/domain/ledger";
import {
  buildQuickEntry,
  QuickDraftSchema,
} from "../src/features/entries/quickEntry";

const container = "supabase_db_bari-khata";
const signature = "public.read_contact_share(text,integer,integer,bigint,text)";
const endpoint = JSON.parse(
  execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }),
)[0].Endpoints.docker.Host;
assert.match(
  process.env.DOCKER_HOST ?? endpoint,
  /^unix:\/\//,
  "Only a local Docker socket may be used.",
);
const image = execFileSync(
  "docker",
  ["inspect", container, "--format", "{{.Config.Image}}"],
  { encoding: "utf8" },
).trim();
assert.match(
  image,
  /supabase\/postgres:/,
  "Only the local Supabase database container may be used.",
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
const signatures = [
  signature,
  "public.ledger_document_is_valid(jsonb)",
  "public.ledger_relations_are_valid(jsonb)",
  "public.ledger_evolution_is_valid(jsonb,jsonb)",
  "public.contract_terms(jsonb)",
  "public.contract_snapshot_is_valid(jsonb,jsonb)",
  "public.ledger_contracts_are_valid(jsonb)",
];
const fingerprint = () =>
  db(
    `select jsonb_object_agg(name,coalesce(md5(pg_get_functiondef(to_regprocedure(name))),'absent')) from unnest(array[${signatures.map(quote).join(",")}]) name;`,
  );
const original = fingerprint();
const constraintState = () =>
  db(
    "select coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname='ledger_contracts_valid' and conrelid='public.ledger_documents'::regclass),'absent');",
  );
const originalConstraint = constraintState();

const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611020004_contract_scopes_and_running_balances.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const chunks = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s'; set local idle_in_transaction_session_timeout='30s';",
  ...(originalConstraint === "absent" ? [migration] : []),
];
const owners: string[] = [];
const base = () =>
  LedgerSchema.parse({
    works: [
      { id: "door", name: "Synthetic door" },
      { id: "roof", name: "Synthetic roof" },
    ],
    people: [
      { id: "shop", name: "Synthetic shop", kind: "shop" },
      {
        id: "worker",
        name: "Synthetic worker",
        kind: "worker",
        phone: "PRIVATE_FIXTURE_PHONE",
      },
    ],
  });
function insert(ledger: ReturnType<typeof base>) {
  const owner = randomUUID();
  owners.push(owner);
  chunks.push(
    `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`contract-rollback-${owner}@example.invalid`)});`,
  );
  chunks.push(
    `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${quote(JSON.stringify(ledger))}::jsonb);`,
  );
  return owner;
}
let checkedShares = 0;
function share(
  owner: string,
  ledger: ReturnType<typeof base>,
  personId: string,
  account: "materials" | "labour",
  workId?: string,
) {
  const token = randomBytes(32).toString("hex");
  const person = ledger.people.find((person) => person.id === personId)!;
  const expected = contactAccountSummary(ledger, person, account, workId);
  const totals = {
    cost: expected.cost,
    paid: expected.netPaid,
    payable: expected.payable,
    advance: expected.advance,
    historicalCost: expected.historicalCost,
  };
  const contracts =
    account === "labour"
      ? ledger.contracts
          .filter(
            (contract) =>
              contract.personId === personId &&
              (!workId ||
                (contract.scope === "work" && contract.workId === workId)),
          )
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((contract) => {
            const own = contractSummary(ledger, contract.id);
            return {
              title: contract.title,
              workName:
                ledger.works.find((work) => work.id === contract.workId)
                  ?.name ?? "",
              total: contract.total,
              netPaid: own.netPaid,
              remaining: own.remaining,
            };
          })
      : [];
  chunks.push(
    `insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash) values (${quote(owner)}::uuid,${quote(personId)},${quote(account)},${workId ? quote(workId) : "null"},encode(extensions.digest(${quote(token)},'sha256'),'hex'));`,
  );
  chunks.push(`set local role anon;
do $contract_share$
declare actual jsonb;
begin
  actual:=public.read_contact_share(${quote(token)},0,40,null,null);
  if actual->'totals' is distinct from ${quote(JSON.stringify(totals))}::jsonb then raise exception 'contract_share_totals: %',actual->'totals'; end if;
  if actual->'contracts' is distinct from ${quote(JSON.stringify(contracts))}::jsonb then raise exception 'contract_share_scope_or_progress: %',actual->'contracts'; end if;
  if position('PRIVATE_FIXTURE_PHONE' in actual::text)>0 then raise exception 'private_field_leak'; end if;
end;
$contract_share$; reset role;`);
  checkedShares++;
}
let shop = base();
for (const [index, workId, amount, paid] of [
  [1, "door", "60000", "20000"],
  [2, "roof", "10000", "20000"],
] as const)
  shop = buildQuickEntry(
    shop,
    QuickDraftSchema.parse({
      id: `bill-${index}`,
      paymentId: `paid-${index}`,
      workId,
      personId: "shop",
      date: "2026-11-02",
      payment: "partial",
      paid,
      rows: [{ id: `line-${index}`, label: "Synthetic goods", amount }],
    }),
  );
const shopOwner = insert(shop);
share(shopOwner, shop, "shop", "materials");
share(shopOwner, shop, "shop", "materials", "door");
share(shopOwner, shop, "shop", "materials", "roof");
let house = saveContractChange(
  base(),
  ContractSchema.parse({
    id: "house",
    scope: "house",
    personId: "worker",
    title: "Synthetic whole house",
    total: 60000000,
    rate: 60000000,
    agreedOn: "2026-10-01",
  }),
  "",
  "2026-11-01T00:00:00Z",
);
house = saveContractChange(
  house,
  ContractSchema.parse({
    ...house.contracts[0],
    total: 65000000,
    rate: 65000000,
  }),
  "Synthetic extra work",
  "2026-11-02T00:00:00Z",
);
house = saveContractChange(
  house,
  ContractSchema.parse({
    id: "door-only",
    scope: "work",
    workId: "door",
    personId: "worker",
    title: "Synthetic door agreement",
    basis: "day",
    quantity: "2.5",
    rate: 80000,
    total: 200000,
  }),
  "",
  "2026-11-01T00:00:00Z",
);
for (const [id, workId, amount, contractId] of [
  ["door-cash", "door", "30000", "house"],
  ["roof-cash", "roof", "10000", "house"],
  ["separate-cash", "door", "1000", "door-only"],
])
  house = buildQuickEntry(
    house,
    QuickDraftSchema.parse({
      id,
      kind: "payment",
      purpose: "settle",
      account: "labour",
      personId: "worker",
      contractId,
      workId,
      amount,
      date: "2026-11-02",
    }),
  );
const houseOwner = insert(house);
share(houseOwner, house, "worker", "labour");
share(houseOwner, house, "worker", "labour", "door");
share(houseOwner, house, "worker", "labour", "roof");
const noWorks = saveContractChange(
  LedgerSchema.parse({
    people: [{ id: "worker", name: "Synthetic worker", kind: "worker" }],
  }),
  ContractSchema.parse({
    id: "no-work-house",
    scope: "house",
    personId: "worker",
    total: 60000000,
  }),
);
insert(noWorks);
const changed = saveContractChange(
  house,
  ContractSchema.parse({
    ...house.contracts.find((c) => c.id === "house")!,
    total: 66000000,
    rate: 66000000,
  }),
  "Synthetic revised work",
  "2026-11-03T00:00:00Z",
);
chunks.push(
  `update public.ledger_documents set document=${quote(JSON.stringify(changed))}::jsonb where owner_id=${quote(houseOwner)}::uuid;`,
);
const tampered = structuredClone(changed);
tampered.contracts.find(
  (contract) => contract.id === "house",
)!.activity[0].reason = "Changed old reason";
const broken = structuredClone(changed);
broken.contracts.find(
  (contract) => contract.id === "house",
)!.activity[1].before!.total = 1;
const wrongWork = structuredClone(house);
wrongWork.entries.find(
  (entry) => entry.id === "separate-cash",
)!.allocations[0].workId = "roof";
const legacy = LedgerSchema.parse({
  ...base(),
  contracts: [
    { id: "legacy", workId: "door", personId: "worker", total: 100000 },
  ],
});
const legacyChanged = saveContractChange(
  legacy,
  ContractSchema.parse({ ...legacy.contracts[0], total: 200000 }),
  "Synthetic more work",
);
const invented = structuredClone(legacyChanged);
invented.contracts[0].activity[0].before!.total = 1;
const legacyRate = LedgerSchema.parse({
  ...base(),
  contracts: [
    {
      id: "legacy-rate",
      workId: "door",
      personId: "worker",
      basis: "day",
      quantity: "2",
      rate: 10000,
      total: 30000,
    },
  ],
});
const correctedRate = saveContractChange(
  legacyRate,
  ContractSchema.parse({ ...legacyRate.contracts[0], total: 20000 }),
  "Synthetic corrected multiplication",
);
const badRate = structuredClone(correctedRate);
badRate.contracts[0].total = 30000;
badRate.contracts[0].activity[0].after.total = 30000;
const roundedRate = saveContractChange(
  base(),
  ContractSchema.parse({
    id: "rounded-rate",
    workId: "door",
    personId: "worker",
    basis: "sqft",
    quantity: "0.005",
    rate: 100,
    total: 1,
  }),
);
chunks.push(`do $contract_guards$
declare rejected boolean:=false;
begin
  if not public.ledger_contracts_are_valid(${quote(JSON.stringify(legacyRate))}::jsonb) then raise exception 'legacy_rate_total_was_invalidated'; end if;
  if not public.ledger_contracts_are_valid(${quote(JSON.stringify(correctedRate))}::jsonb) then raise exception 'legacy_rate_correction_rejected'; end if;
  if public.ledger_contracts_are_valid(${quote(JSON.stringify(badRate))}::jsonb) then raise exception 'audited_wrong_rate_total_accepted'; end if;
  if not public.ledger_contracts_are_valid(${quote(JSON.stringify(roundedRate))}::jsonb) then raise exception 'exact_half_paisa_rounding_rejected'; end if;
  if not public.ledger_contracts_are_valid(${quote(JSON.stringify(invented))}::jsonb) then raise exception 'boundary_fixture_not_independently_valid'; end if;
  if public.ledger_evolution_is_valid(${quote(JSON.stringify(legacy))}::jsonb,${quote(JSON.stringify(invented))}::jsonb) then raise exception 'invented_first_before_snapshot_accepted'; end if;
  if not public.ledger_evolution_is_valid(${quote(JSON.stringify(legacy))}::jsonb,${quote(JSON.stringify(legacyChanged))}::jsonb) then raise exception 'valid_first_before_snapshot_rejected'; end if;
  if public.ledger_contracts_are_valid(${quote(JSON.stringify(broken))}::jsonb) then raise exception 'broken_contract_chain_accepted'; end if;
  if public.ledger_relations_are_valid(${quote(JSON.stringify(wrongWork))}::jsonb) then raise exception 'work_contract_wrong_work_accepted'; end if;
  begin
    update public.ledger_documents set document=${quote(JSON.stringify(tampered))}::jsonb where owner_id=${quote(houseOwner)}::uuid;
  exception when others then
    if sqlerrm='ledger_history_would_be_lost' then rejected:=true; else raise; end if;
  end;
  if not rejected then raise exception 'old_contract_history_was_mutable'; end if;
end;
$contract_guards$;
set local role anon;
do $invalid_link$ begin
  if public.read_contact_share('invalid-token') is not null then raise exception 'invalid_link_exposed_data'; end if;
end; $invalid_link$;
reset role;
select 'contract_running_balance_rollback_passed'; rollback;`);
try {
  assert.equal(
    db(chunks.join("\n")),
    "contract_running_balance_rollback_passed",
  );
} finally {
  assert.equal(
    fingerprint(),
    original,
    "Every replaced function must be rolled back.",
  );
  const ids = owners.map((id) => `${quote(id)}::uuid`).join(",");
  const clean = JSON.parse(
    db(
      `select json_build_object('usersAbsent',not exists(select 1 from auth.users where id in (${ids})),'ledgersAbsent',not exists(select 1 from public.ledger_documents where owner_id in (${ids})),'linksAbsent',not exists(select 1 from public.contact_share_links where owner_id in (${ids})),'constraintUnchanged',coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname='ledger_contracts_valid' and conrelid='public.ledger_documents'::regclass),'absent')=${quote(originalConstraint)});`,
    ),
  );
  assert.deepEqual(clean, {
    usersAbsent: true,
    ledgersAbsent: true,
    linksAbsent: true,
    constraintUnchanged: true,
  });
}
console.log(
  `Local Supabase SQL: ${checkedShares} running-balance/contract shares, house privacy, validation/history guards and full rollback verified (${originalConstraint === "absent" ? "temporary migration" : "existing schema"}).`,
);

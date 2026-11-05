import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LedgerSchema } from "../src/domain/model";
import { reconciledTotals } from "../src/domain/adjustmentMath";
import { SharedStatementSchema } from "../src/features/sharing/shareModel";
import { appendBalanceAdjustment } from "../src/domain/balanceAdjustments";
import { contractSummary, setEntryVoided } from "../src/domain/ledger";
import { contactAccountSummary } from "../src/domain/contacts";

const container = "supabase_db_bari-khata";
const endpoint = JSON.parse(
  execFileSync("docker", ["context", "inspect"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
)[0].Endpoints.docker.Host;
assert.match(process.env.DOCKER_HOST ?? endpoint, /^unix:\/\//);
assert.match(
  execFileSync(
    "docker",
    ["inspect", container, "--format", "{{.Config.Image}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ),
  /supabase\/postgres:/,
);
const db = (sql: string) =>
  execFileSync(
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
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const fingerprint = () =>
  db(
    "select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'body',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('read_contact_share','ledger_obligation_cash_amount','ledger_unresolved_contract_adjustments','ledger_completed_contract_cost','adjustment_snapshot_is_valid');",
  );
const before = fingerprint();
const owner = randomUUID(),
  ambiguousOwner = randomUUID(),
  markerOwner = randomUUID();
const base = LedgerSchema.parse({
  architectureVersion: 2,
  milestones: [],
  paymentAllocations: [],
  project: { name: "নমুনা অর্জিত কাজ" },
  works: [{ id: "roof", name: "নমুনা ছাদ" }],
  people: [{ id: "party", name: "নমুনা মিস্ত্রি", kind: "worker" }],
  contracts: [
    { id: "agreement", personId: "party", workId: "roof", total: 10000 },
  ],
  entries: [
    {
      id: "earned",
      kind: "expense",
      personId: "party",
      account: "labour",
      contractId: "agreement",
      lines: [{ id: "line", workId: "roof", amount: 3000, costType: "labour" }],
    },
    {
      id: "paid",
      kind: "payment",
      personId: "party",
      account: "labour",
      contractId: "agreement",
      allocations: [{ workId: "roof", amount: 1000 }],
      paymentParts: [{ method: "cash", amount: 1000 }],
    },
  ],
});
const ambiguous = LedgerSchema.parse({
  ...base,
  entries: [
    {
      id: "old-discount",
      kind: "adjustment",
      personId: "party",
      account: "labour",
      contractId: "agreement",
      note: "নমুনা পুরোনো চুক্তির ছাড়",
      adjustment: {
        target: "person",
        basis: "balance",
        account: "labour",
        workId: "roof",
        before: 10000,
        after: 8000,
        delta: -2000,
      },
    },
  ],
});
assert.equal(reconciledTotals(base).reconciledPayable, 2000);
assert.equal(reconciledTotals(ambiguous).reconciledAdvance, 0);
assert.deepEqual(reconciledTotals(ambiguous).unresolvedAdjustmentIds, [
  "old-discount",
]);
const later = LedgerSchema.parse({
  ...base,
  entries: [
    ...base.entries,
    ambiguous.entries[0],
    {
      ...base.entries[0],
      id: "later-earned",
      lines: [{ ...base.entries[0].lines[0], id: "later-line", amount: 7000 }],
    },
  ],
});
const revised = LedgerSchema.parse({
  ...later,
  contracts: [{ ...later.contracts[0], total: 2000 }],
});
const marked = appendBalanceAdjustment(base, {
  target: "person",
  basis: "balance",
  personId: "party",
  account: "labour",
  contractId: "agreement",
  expectedBefore: 2000,
  after: 1500,
  reason: "নমুনা অর্জিত পাওনা মিলিয়েছি",
});
const stripped = structuredClone(marked);
delete stripped.entries.at(-1)!.adjustment!.calculationVersion;
const promoted = structuredClone(ambiguous);
promoted.entries[0].adjustment!.calculationVersion = 2;
const invalidVersion = structuredClone(marked) as unknown as {
  entries: { adjustment?: { calculationVersion?: number } }[];
};
invalidVersion.entries.at(-1)!.adjustment!.calculationVersion = 3;
const voidedMarked = setEntryVoided(marked, marked.entries.at(-1)!.id, true);
const completedCases = [
  { name: "unpaid", entries: [], status: "done" },
  {
    name: "overpaid",
    entries: [
      {
        ...base.entries[1],
        paymentParts: [{ amount: 11000 }],
        allocations: [{ workId: "roof", amount: 11000 }],
      },
    ],
    status: "done",
  },
  { name: "explicit", entries: base.entries, status: "done" },
  {
    name: "voided",
    entries: [{ ...base.entries[0], voided: true }],
    status: "done",
  },
  {
    name: "historical",
    entries: [{ ...base.entries[0], balanceImpact: "historical" }],
    status: "done",
  },
  { name: "planned", entries: [], status: "planned" },
  { name: "ongoing", entries: [], status: "ongoing" },
  {
    name: "separate-credit",
    entries: [{ ...base.entries[1], contractId: null }],
    status: "done",
  },
].map((row, index) => ({
  name: row.name,
  owner: randomUUID(),
  token: String(index + 1).repeat(64),
  ledger: LedgerSchema.parse({
    ...base,
    contracts: [{ ...base.contracts[0], status: row.status }],
    entries: row.entries,
  }),
}));
const strip = (source: string) =>
  source
    .trim()
    .replace(/^begin;\s*/i, "")
    .replace(/\s*commit;$/i, "");
const architecture = readFileSync(
  new URL(
    "../supabase/migrations/202611050002_party_ledger_architecture.sql",
    import.meta.url,
  ),
  "utf8",
);
const helperStart = architecture.indexOf(
  "create function private.ledger_obligation_cash_amount",
);
assert.ok(helperStart >= 0);
const helper = architecture
  .slice(
    helperStart,
    architecture.indexOf(
      "create or replace function public.read_contact_share",
      helperStart,
    ),
  )
  .replace(/^create function/, "create or replace function");
const migration = strip(
  readFileSync(
    new URL(
      "../supabase/migrations/202611050004_earned_obligations.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const completedMigration = strip(
  readFileSync(
    new URL(
      "../supabase/migrations/202611050005_completed_contract_earnings.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const sql = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s';",
  helper,
  migration,
  completedMigration,
  `insert into auth.users(id,email) values (${quote(owner)}::uuid,${quote(`earned-${owner}@example.invalid`)}),(${quote(ambiguousOwner)}::uuid,${quote(`unclear-${ambiguousOwner}@example.invalid`)}),(${quote(markerOwner)}::uuid,${quote(`marker-${markerOwner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(base)}),(${quote(ambiguousOwner)}::uuid,1,${json(ambiguous)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(markerOwner)}::uuid,1,${json(marked)});`,
  `insert into public.contact_share_links(owner_id,person_id,account,token_hash) values (${quote(owner)}::uuid,'party','labour',encode(extensions.digest(repeat('e',64),'sha256'),'hex')),(${quote(ambiguousOwner)}::uuid,'party','labour',encode(extensions.digest(repeat('f',64),'sha256'),'hex'));`,
  ...completedCases.flatMap((row) => [
    `insert into auth.users(id,email) values (${quote(row.owner)}::uuid,${quote(`completed-${row.owner}@example.invalid`)});`,
    `insert into public.ledger_documents(owner_id,revision,document) values (${quote(row.owner)}::uuid,1,${json(row.ledger)});`,
    `insert into public.contact_share_links(owner_id,person_id,account,token_hash) values (${quote(row.owner)}::uuid,'party','labour',encode(extensions.digest(${quote(row.token)},'sha256'),'hex'));`,
  ]),
  `do $stable$ begin
    if private.ledger_unresolved_contract_adjustments(${json(later)})<>array['old-discount'] or private.ledger_unresolved_contract_adjustments(${json(revised)})<>array['old-discount'] then raise exception 'later_facts_cleared_old_ambiguity'; end if;
    if private.ledger_unresolved_contract_adjustments(${json(marked)})<>'{}'::text[] or not public.ledger_adjustments_are_valid(${json(marked)}) or not public.ledger_adjustments_are_valid(${json(voidedMarked)}) then raise exception 'new_earned_marker_or_history_rejected'; end if;
    if public.balance_adjustments_are_preserved(${json(ambiguous)},${json(promoted)}) or public.balance_adjustments_are_preserved(${json(marked)},${json(stripped)}) then raise exception 'marker_retyping_allowed'; end if;
    if public.ledger_adjustments_are_valid(${json(invalidVersion)}) then raise exception 'future_calculation_version_allowed'; end if;
    begin update public.ledger_documents set document=${json(stripped)} where owner_id=${quote(markerOwner)}::uuid; raise exception 'old_client_stripped_marker';
    exception when others then if sqlerrm not in ('balance_adjustment_would_be_lost','ledger_history_would_be_lost') then raise; end if; end;
    if (select document#>>array['entries',${quote(String(marked.entries.length - 1))},'adjustment','calculationVersion'] from public.ledger_documents where owner_id=${quote(markerOwner)}::uuid)<>'2' then raise exception 'marker_was_lost'; end if;
  end; $stable$;`,
  "set local role anon; select public.read_contact_share(repeat('e',64)); select public.read_contact_share(repeat('f',64));",
  ...completedCases.map(
    (row) => `select public.read_contact_share(${quote(row.token)});`,
  ),
  "reset role; rollback;",
].join("\n");
try {
  const [earned, unclear, ...completedStatements] = db(sql)
    .split("\n")
    .map((line) => SharedStatementSchema.parse(JSON.parse(line)));
  assert.equal(earned.totals.payable, 2000);
  assert.equal(earned.totals.paid, 1000);
  assert.equal(earned.totals.cost, 3000);
  assert.equal(earned.totals.earnedPayable, 2000);
  assert.equal(earned.contracts[0].remaining, 2000);
  assert.equal(earned.contracts[0].remainingCommitment, 9000);
  assert.equal(earned.contracts[0].unearnedCommitment, 7000);
  assert.equal(unclear.totals.balanceAmbiguous, true);
  assert.equal(unclear.totals.earnedPayable, null);
  assert.equal(unclear.totals.advance, 0);
  assert.equal(unclear.contracts[0].remaining, 0);
  assert.equal(unclear.contracts[0].remainingCommitment, 8000);
  completedCases.forEach((row, index) => {
    const statement = completedStatements[index];
    const canonical = contactAccountSummary(
      row.ledger,
      row.ledger.people[0],
      "labour",
    );
    const contract = contractSummary(row.ledger, "agreement");
    assert.equal(
      statement.totals.payable,
      canonical.reconciledPayable,
      row.name,
    );
    assert.equal(
      statement.totals.advance,
      canonical.reconciledAdvance,
      row.name,
    );
    assert.equal(
      statement.totals.reconciledCost,
      canonical.reconciledCost,
      row.name,
    );
    assert.equal(statement.totals.actualPaid, canonical.actualPaid, row.name);
    assert.equal(
      statement.contracts[0].remaining,
      contract.remaining,
      row.name,
    );
    assert.equal(
      statement.contracts[0].unearnedCommitment,
      contract.unearnedCommitment,
      row.name,
    );
    assert.equal(
      statement.rows.length,
      row.ledger.entries.filter((entry) => !entry.voided).length,
      row.name,
    );
  });
} finally {
  assert.equal(
    fingerprint(),
    before,
    "পরীক্ষার পরে function ও permission আগের মতো থাকতে হবে।",
  );
  assert.equal(
    db(
      `select count(*) from auth.users where id in (${[owner, ambiguousOwner, markerOwner, ...completedCases.map((row) => row.owner)].map((id) => `${quote(id)}::uuid`).join(",")});`,
    ),
    "0",
  );
}
process.stdout.write(
  "স্থানীয় Supabase: সম্পন্ন কাজের পাওনা, বিল একবার গণনা, কাজের বিলের বাকি, ভবিষ্যৎ চুক্তি, পুরোনো অস্পষ্ট ছাড়, browser schema এবং rollback যাচাই সফল।\n",
);

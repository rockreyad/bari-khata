import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { LedgerSchema, type Ledger } from "../src/domain/model";

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
    { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  ).trim();
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const fingerprint = () =>
  db(`select jsonb_build_object(
  'functions',(select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'body',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('party_ledger_architecture_is_valid','preserve_party_ledger_architecture','mcp_document_changes','read_contact_share','ledger_obligation_cash_amount')),
  'constraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.ledger_documents'::regclass and conname='party_ledger_architecture_valid'),
  'trigger',(select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.ledger_documents'::regclass and tgname='ledger_preserve_party_architecture'));`);
const before = fingerprint();
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611050002_party_ledger_architecture.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const ledger = LedgerSchema.parse({
  architectureVersion: 2,
  works: [
    { id: "work", name: "নমুনা কাজ" },
    { id: "other-work", name: "আরেক কাজ" },
  ],
  people: [
    {
      id: "party",
      name: "নমুনা ব্যক্তি",
      roles: ["supplier", "transport"],
      identityType: "person",
    },
    { id: "other-party", name: "অন্য ব্যক্তি", roles: [] },
  ],
  contracts: [
    { id: "contract", personId: "party", workId: "work", total: 1000 },
  ],
  milestones: [
    {
      id: "stage",
      contractId: "contract",
      title: "প্রথম ধাপ",
      amount: 500,
      dueOn: null,
      status: "planned",
    },
  ],
  entries: [
    ...["bill-1", "bill-2"].map((id) => ({
      id,
      kind: "expense",
      personId: "party",
      account: "materials",
      lines: [{ id: `${id}-line`, workId: "work", amount: 500 }],
    })),
    {
      id: "cash",
      kind: "payment",
      personId: "party",
      account: "materials",
      paymentContext: "advance",
      paymentParts: [{ amount: 700 }],
      allocations: [{ workId: "work", amount: 700 }],
    },
  ],
  paymentAllocations: [
    {
      id: "allocation-1",
      paymentId: "cash",
      billId: "bill-1",
      amount: 400,
      createdAt: "2026-11-05T00:00:00.000Z",
    },
    {
      id: "allocation-2",
      paymentId: "cash",
      billId: "bill-2",
      amount: 300,
      createdAt: "2026-11-05T00:00:00.000Z",
    },
  ],
});
const chunks = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='30s'; set local idle_in_transaction_session_timeout='30s';",
  "set local client_min_messages='warning'; drop trigger if exists ledger_preserve_party_architecture on public.ledger_documents; alter table public.ledger_documents drop constraint if exists party_ledger_architecture_valid; drop function if exists public.preserve_party_ledger_architecture(); drop function if exists public.party_ledger_architecture_is_valid(jsonb);",
  migration,
];
let checks = 0;
function check(document: unknown, valid: boolean) {
  assert.equal(
    LedgerSchema.safeParse(document).success,
    valid,
    `Zod case ${checks}`,
  );
  chunks.push(
    `do $case$ begin if public.party_ledger_architecture_is_valid(${json(document)}) is distinct from ${valid} then raise exception 'architecture_case_${checks}'; end if; end; $case$;`,
  );
  checks++;
}
function changed(update: (copy: Ledger) => void, valid = false) {
  const copy = structuredClone(ledger);
  update(copy);
  check(copy, valid);
}
check(ledger, true);
changed((copy) => {
  copy.people[0].roles = [];
}, true);
changed((copy) => {
  copy.people[0].roles = ["supplier", "supplier"];
});
changed((copy) => {
  copy.paymentAllocations![0].amount = 501;
});
changed((copy) => {
  copy.paymentAllocations![0].amount = 401;
});
changed((copy) => {
  copy.paymentAllocations![0].amount = 0;
});
changed((copy) => {
  copy.paymentAllocations![0].paymentId = "missing";
});
changed((copy) => {
  copy.paymentAllocations![0].billId = "cash";
});
changed((copy) => {
  copy.paymentAllocations![0].workId = "other-work";
});
changed((copy) => {
  copy.paymentAllocations!.push(copy.paymentAllocations![0]);
});
changed((copy) => {
  copy.entries[0].personId = "other-party";
});
changed((copy) => {
  copy.entries[0].voided = true;
});
changed((copy) => {
  copy.entries[0].balanceImpact = "historical";
});
changed((copy) => {
  copy.entries[0].reviewStatus = "needs_review";
});
changed((copy) => {
  copy.entries[0].paymentContext = "advance";
});
changed((copy) => {
  copy.entries[0].milestoneId = "stage";
});
changed((copy) => {
  copy.milestones![0].amount = 1001;
});
changed((copy) => {
  copy.milestones![0].contractId = "missing";
});
changed((copy) => {
  copy.milestones![0].dueOn = "2026-02-30";
});
changed((copy) => {
  copy.entries.push({
    ...copy.entries[2],
    id: "refund",
    kind: "refund",
    paymentParts: [{ method: "cash", amount: 1 }],
    allocations: [{ workId: "work", amount: 1 }],
  });
});
changed((copy) => {
  copy.entries.push({
    ...copy.entries[0],
    id: "credit",
    kind: "expense_credit",
    relatedEntryId: "bill-1",
    lines: [{ ...copy.entries[0].lines[0], id: "credit-line", amount: 101 }],
  });
});
changed((copy) => {
  copy.entries[0].lines[0].amount = 200;
  copy.entries[0].lines.push({
    ...copy.entries[0].lines[0],
    id: "other-line",
    workId: "other-work",
    amount: 300,
  });
});
changed((copy) => {
  copy.entries[0].lines[0].amount = 200;
  copy.entries[0].lines.push({
    ...copy.entries[0].lines[0],
    id: "other-line",
    workId: "other-work",
    amount: 300,
  });
  copy.paymentAllocations![0].workId = "work";
});
changed((copy) => {
  copy.paymentAllocations![0].cancelledAt = "2026-11-05T01:00:00.000Z";
  copy.paymentAllocations![0].cancellationReason = "ভুল বিল";
}, true);
changed((copy) => {
  copy.paymentAllocations![0].cancelledAt = "2026-11-05T01:00:00.000Z";
});
changed((copy) => {
  copy.paymentAllocations![0].cancelledAt = "2026-11-04T01:00:00.000Z";
  copy.paymentAllocations![0].cancellationReason = "ভুল বিল";
});
const owner = randomUUID();
chunks.push(
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`architecture-${owner}@example.invalid`)});`,
);
chunks.push(
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(ledger)});`,
);
for (const [expression, error] of [
  ["document-'architectureVersion'", "architecture_would_be_lost"],
  [
    "jsonb_set(document,'{paymentAllocations}','[]'::jsonb)",
    "architecture_history_would_be_lost",
  ],
  [
    "jsonb_set(document,'{people,0}',(document#>'{people,0}')-'roles')",
    "party_identity_would_be_lost",
  ],
]) {
  chunks.push(
    `do $preserve$ begin begin update public.ledger_documents set document=${expression} where owner_id=${quote(owner)}::uuid; raise exception 'omission_allowed'; exception when raise_exception then if sqlerrm<>${quote(error)} then raise; end if; end; end; $preserve$;`,
  );
  checks++;
}
chunks.push(`do $scopes$ declare changes jsonb; begin
  changes:=private.mcp_document_changes(${json({ ...ledger, paymentAllocations: [] })},${json(ledger)});
  if not(changes->'requiredScopes' ? 'entries:update') or (changes->>'amountPaisa')::numeric<>400 then raise exception 'allocation_scope_missing'; end if;
  changes:=private.mcp_document_changes(${json({ ...ledger, milestones: [] })},${json(ledger)});
  if not(changes->'requiredScopes' ? 'contracts:write') then raise exception 'milestone_scope_missing'; end if;
  if has_function_privilege('anon','public.party_ledger_architecture_is_valid(jsonb)','execute') then raise exception 'unexpected_access'; end if;
end; $scopes$; rollback;`);
checks += 3;
const token = randomBytes(32).toString("hex");
const recoverable = structuredClone(ledger);
recoverable.entries[2].paymentContext = "receivable";
recoverable.paymentAllocations = [];
const receiptOwner = randomUUID();
chunks.splice(
  chunks.length - 1,
  0,
  `insert into auth.users(id,aud,role,email) values (${quote(receiptOwner)}::uuid,'authenticated','authenticated',${quote(`receivable-${receiptOwner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(receiptOwner)}::uuid,1,${json(recoverable)});`,
  `insert into public.contact_share_links(owner_id,person_id,account,token_hash) values (${quote(receiptOwner)}::uuid,'party','materials',encode(extensions.digest(${quote(token)},'sha256'),'hex'));`,
  `do $share$ declare result jsonb; begin result:=public.read_contact_share(${quote(token)}); if (result#>>'{totals,payable}')::numeric<>1000 or (result#>>'{totals,actualPaid}')::numeric<>700 then raise exception 'receivable_share_mismatch'; end if; end; $share$;`,
);
checks++;
try {
  db(chunks.join("\n"));
} finally {
  assert.equal(
    fingerprint(),
    before,
    "পরীক্ষার শেষে database সংজ্ঞা অক্ষত থাকতে হবে।",
  );
  assert.equal(
    db(`select count(*) from auth.users where id=${quote(owner)}::uuid;`),
    "0",
  );
}
process.stdout.write(
  `স্থানীয় Supabase: ${checks}টি architecture, হিসাব, অনুমতি ও rollback পরীক্ষা সফল।\n`,
);

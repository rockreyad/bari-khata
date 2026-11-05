import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { EntrySchema, LedgerSchema } from "../src/domain/model";

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
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const fingerprint = () =>
  db(
    "select jsonb_agg(jsonb_build_object('name',n.nspname||'.'||p.proname,'body',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('contact_share_bill_payments','contact_share_settlement','contact_share_payment_page','read_contact_share_activity','read_contact_share_entry');",
  );
const before = fingerprint();
const owner = randomUUID();
const at = "2026-11-05T00:00:00.000Z";
const bill = (id: string, workId: string, amount: number, personId = "shop") =>
  EntrySchema.parse({
    id,
    kind: "expense",
    personId,
    date: "2026-11-04",
    createdAt: at,
    lines: [
      {
        id: `${id}-line`,
        workId,
        label: workId === "floor" ? "private-floor-label" : "নমুনা বিল",
        amount,
      },
    ],
  });
const cash = (
  id: string,
  amount: number,
  relatedEntryId: string | null = null,
) =>
  EntrySchema.parse({
    id,
    kind: "payment",
    personId: "shop",
    relatedEntryId,
    note: id,
    date: "2026-11-05",
    createdAt: at,
    allocations: [{ workId: "roof", amount }],
    paymentParts: [{ method: "cash", amount }],
  });
const combined = cash("combined", 10000, "roof-bill");
combined.allocations = [
  { workId: "roof", amount: 6000 },
  { workId: "floor", amount: 4000 },
];
combined.note = "private floor detail";
const deposit = {
  ...cash("deposit", 3000, "roof-bill"),
  paymentContext: "receivable" as const,
};
const sharedBill = bill("roof-bill", "roof", 10000);
sharedBill.lines.push({
  ...sharedBill.lines[0],
  id: "private-floor-line",
  workId: "floor",
  label: "private-floor-label",
  amount: 5000,
});
const entries = [
  sharedBill,
  bill("floor-bill", "floor", 20000),
  bill("secret-bill", "roof", 50000, "secret"),
  combined,
  deposit,
  cash("legacy", 1000, "roof-bill"),
  cash("cancelled-payment", 2000),
  ...Array.from({ length: 25 }, (_, index) => cash(`paid-${index}`, 100)),
];
const allocation = (
  id: string,
  paymentId: string,
  billId: string,
  amount: number,
  workId: string,
) => ({ id, paymentId, billId, amount, workId, createdAt: at });
const ledger = LedgerSchema.parse({
  architectureVersion: 2,
  milestones: [],
  project: { id: "synthetic", name: "নমুনা ভাগ করা হিসাব" },
  works: [
    { id: "roof", name: "নমুনা ছাদ" },
    { id: "floor", name: "private-floor-work" },
  ],
  people: [
    { id: "shop", name: "নমুনা দোকান", kind: "shop" },
    { id: "secret", name: "private-other-person" },
  ],
  entries,
  paymentAllocations: [
    allocation("combined-roof", "combined", "roof-bill", 5000, "roof"),
    allocation("combined-floor", "combined", "floor-bill", 4000, "floor"),
    {
      ...allocation(
        "cancelled",
        "cancelled-payment",
        "roof-bill",
        2000,
        "roof",
      ),
      cancelledAt: at,
      cancellationReason: "নমুনা ভুল মিল বাতিল",
    },
    ...Array.from({ length: 25 }, (_, index) =>
      allocation(
        `allocation-${index}`,
        `paid-${index}`,
        "roof-bill",
        100,
        "roof",
      ),
    ),
  ],
});
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611050003_shared_payment_allocations.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const sql = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='30s';",
  migration,
  `insert into auth.users(id,email) values (${quote(owner)}::uuid,${quote(`allocation-share-${owner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(ledger)});`,
  `insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash,revoked_at) values (${quote(owner)}::uuid,'shop','materials','roof',encode(extensions.digest(repeat('d',64),'sha256'),'hex'),null);`,
  `do $permissions$ begin
    if has_function_privilege('anon','private.contact_share_bill_payments(jsonb)','execute') then raise exception 'private_helper_exposed'; end if;
    if not has_function_privilege('anon','public.read_contact_share_payments(text,text,bigint,integer,integer)','execute') then raise exception 'public_page_permission_lost'; end if;
  end; $permissions$;`,
  "set local role anon;",
  `do $checks$ declare detail jsonb; result jsonb; page jsonb; row jsonb; paid numeric:=0; total integer:=0; offset_value integer:=0; begin
    detail:=public.read_contact_share_entry(repeat('d',64),'roof-bill',1);
    if detail#>>'{settlement,paid}'<>'8500' or detail#>>'{settlement,balance}'<>'1500' or detail#>>'{settlement,paymentCount}'<>'27' then raise exception 'wrong_explicit_bill_settlement %',detail; end if;
    if jsonb_array_length(detail->'payments')<>20 or detail->>'paymentsNextOffset'<>'20' or detail->>'paymentsTotal'<>'27' then raise exception 'unbounded_first_page'; end if;
    loop
      page:=public.read_contact_share_payments(repeat('d',64),'roof-bill',1,offset_value,20);
      if jsonb_array_length(page->'payments')>20 then raise exception 'unbounded_page'; end if;
      for row in select value from jsonb_array_elements(page->'payments') loop
        paid:=paid+(row->>'paid')::numeric; total:=total+1;
        if row->>'key'='combined' and (row->>'paid'<>'5000' or row->'paymentParts'<>'[]'::jsonb or row->'paymentMethods'<>'[]'::jsonb) then raise exception 'mixed_work_cash_leaked'; end if;
      end loop;
      exit when page->>'nextOffset' is null;
      offset_value:=(page->>'nextOffset')::integer;
    end loop;
    if total<>27 or paid<>8500 then raise exception 'wrong_payment_pages'; end if;
    if public.read_contact_share_entry(repeat('d',64),'floor-bill',1) is not null or public.read_contact_share_entry(repeat('d',64),'secret-bill',1) is not null then raise exception 'unshared_bill_visible'; end if;
    result:=public.read_contact_share_entry(repeat('d',64),'deposit',1);
    if result ? 'relatedBill' then raise exception 'unallocated_receivable_settled_bill'; end if;
    result:=public.read_contact_share_activity(repeat('d',64),0,20,1,null,null);
    if result->>'total'<>'4' then raise exception 'cash_remainder_hidden %',result; end if;
    if result::text like '%private-floor%' or result::text like '%private floor%' or result::text like '%private-other%' then raise exception 'unshared_details_leaked'; end if;
    result:=public.read_contact_share_activity(repeat('d',64),0,20,1,'paid-24',null);
    if result->>'total'<>'1' or result#>>'{rows,0,key}'<>'roof-bill' then raise exception 'allocation_payment_search_missing'; end if;
    begin perform public.read_contact_share_payments(repeat('d',64),'roof-bill',1,0,21); raise exception 'page_limit_missing'; exception when others then if sqlerrm<>'invalid_share_page' then raise; end if; end;
    begin perform public.read_contact_share_entry(repeat('d',64),'roof-bill',2); raise exception 'revision_guard_missing'; exception when others then if sqlerrm<>'share_changed' then raise; end if; end;
  end; $checks$;`,
  "reset role; select 'shared_allocations_rollback_passed'; rollback;",
].join("\n");
try {
  assert.equal(db(sql), "shared_allocations_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    before,
    "পরীক্ষার শেষে আগের function ও permission ফিরতে হবে।",
  );
  assert.equal(
    db(`select count(*) from auth.users where id=${quote(owner)}::uuid;`),
    "0",
    "নমুনা তথ্য রাখা যাবে না।",
  );
}
process.stdout.write(
  "স্থানীয় Supabase: বিলে ভাগ করা টাকা, আংশিক পরিশোধ, ফেরতযোগ্য জমা, বাতিল মিল, সীমিত পাতা, গোপনীয়তা ও rollback যাচাই সফল।\n",
);

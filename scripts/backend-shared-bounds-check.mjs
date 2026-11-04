import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const status = JSON.parse(
  execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
assert.match(status.API_URL ?? "", /^http:\/\/(127\.0\.0\.1|localhost):55431$/);
const owner = randomUUID();
const largeOwner = randomUUID();
const context = (name, entries) => ({
  schemaVersion: 1,
  isDemo: false,
  project: { id: name, name: "নমুনা সীমা পরীক্ষা", currency: "BDT" },
  works: [
    { id: "roof", name: "নমুনা ছাদ" },
    { id: "floor", name: "নমুনা মেঝে" },
  ],
  people: [
    { id: "shop", name: "নমুনা দোকান", kind: "shop" },
    { id: "other", name: "অন্য নমুনা দোকান", kind: "shop" },
  ],
  items: [],
  contracts: [],
  entries,
});
const base = (id, kind, personId = "shop") => ({
  id,
  kind,
  personId,
  account: "materials",
  date: "2026-11-04",
  createdAt: "2026-11-04T00:00:00Z",
  updatedAt: "2026-11-04T00:00:00Z",
  lines: [],
  allocations: [],
  paymentParts: [],
  receipts: [],
});
const bill = (id, personId = "shop") => ({
  ...base(id, "expense", personId),
  lines: [
    {
      id: `${id}-line`,
      workId: "roof",
      label: "নমুনা সিমেন্ট",
      costType: "material",
      amount: 1000000,
    },
  ],
});
const payment = (id, relatedEntryId = "bill") => ({
  ...base(id, "payment"),
  relatedEntryId,
  allocations: [{ workId: "roof", amount: 100 }],
  paymentParts: [{ method: "cash", amount: 100 }],
  note: `নমুনা পরিশোধের কথা ${id}`,
});
const receipt = (id) => ({
  id,
  name: "sample.png",
  mime: "image/png",
  size: 10,
});
const entries = [
  { ...bill("bill"), receipts: [receipt("receipt")] },
  ...Array.from({ length: 500 }, (_, index) => payment(`paid-${index}`)),
  { ...payment("voided"), voided: true },
  { ...payment("historical"), balanceImpact: "historical" },
  {
    ...bill("split"),
    lines: [
      ...bill("split").lines,
      {
        id: "split-floor",
        workId: "floor",
        label: "গোপন অন্য খাতা",
        costType: "material",
        amount: 2000,
      },
    ],
    receipts: [receipt("split-receipt")],
  },
  {
    ...payment("split-paid", "split"),
    allocations: [
      { workId: "roof", amount: 100 },
      { workId: "floor", amount: 200 },
    ],
    paymentParts: [{ method: "cash", amount: 300 }],
  },
  { ...bill("unrelated", "other"), receipts: [receipt("other-receipt")] },
];
const large = context(
  "large",
  Array.from({ length: 10000 }, (_, index) => bill(`large-${index}`)),
);
const document = context("detail", entries);
const jsonSql = (value) => `$fixture$${JSON.stringify(value)}$fixture$::jsonb`;
const sql = `
\\set ON_ERROR_STOP on
begin;
set local statement_timeout='60s';
insert into auth.users(id,email) values
  ('${owner}','bounded-${owner}@example.invalid'),
  ('${largeOwner}','bounded-${largeOwner}@example.invalid');
insert into public.ledger_documents(owner_id,revision,document) values
  ('${owner}',1,${jsonSql(document)}),('${largeOwner}',1,${jsonSql(large)});
insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash,revoked_at) values
  ('${owner}','shop','materials','roof',encode(extensions.digest(repeat('a',64),'sha256'),'hex'),null),
  ('${largeOwner}','shop','materials',null,encode(extensions.digest(repeat('b',64),'sha256'),'hex'),null),
  ('${owner}','shop','materials','roof',encode(extensions.digest(repeat('c',64),'sha256'),'hex'),now());
do $$ begin
  assert has_function_privilege('anon','public.read_contact_share_payments(text,text,bigint,integer,integer)','execute');
  assert has_function_privilege('authenticated','public.read_contact_share_payments(text,text,bigint,integer,integer)','execute');
  assert not has_function_privilege('anon','private.contact_share_payment_page(jsonb,text,integer,integer)','execute');
  assert not has_function_privilege('authenticated','private.contact_share_payment_page(jsonb,text,integer,integer)','execute');
  assert not has_function_privilege('anon','public.contact_share_receipt_authorization(text,text,text,bigint)','execute');
  assert has_function_privilege('service_role','public.contact_share_receipt_authorization(text,text,text,bigint)','execute');
  assert public.contact_share_receipt_authorization(repeat('a',64),'bill','receipt',1)->>'storagePath'='${owner}/receipt';
  assert public.contact_share_receipt_authorization(repeat('a',64),'split','split-receipt',1) is null;
  assert public.contact_share_receipt_authorization(repeat('a',64),'unrelated','other-receipt',1) is null;
  assert public.contact_share_receipt_authorization(repeat('c',64),'bill','receipt',1) is null;
  assert public.contact_share_receipt_authorization(repeat('a',64),'bill','../receipt',1) is null;
end $$;
set local role anon;
set local statement_timeout='3s';
do $$ declare
  result jsonb; detail jsonb; page jsonb; all_keys text[]:='{}'; row jsonb;
  offset_value integer:=0; amount numeric:=0; started timestamptz;
begin
  started:=clock_timestamp();
  result:=public.read_contact_share_activity(repeat('b',64),0,20,1,null,null);
  assert (result->>'total')::integer=10000;
  assert jsonb_array_length(result->'rows')=20 and (result->>'nextOffset')::integer=20;
  assert (result#>>'{totals,actualCost}')::numeric=10000000000;
  raise notice '১০,০০০ লেনদেনের প্রথম ২০ সারি: % ms',round(extract(epoch from clock_timestamp()-started)*1000);
  started:=clock_timestamp();
  detail:=public.read_contact_share_entry(repeat('a',64),'bill',1);
  assert jsonb_array_length(detail->'payments')=20;
  assert (detail->>'paymentsTotal')::integer=500 and (detail->>'paymentsNextOffset')::integer=20;
  assert (detail#>>'{settlement,paymentCount}')::integer=500 and (detail#>>'{settlement,paid}')::numeric=50000;
  raise notice '৫০০ পরিশোধের প্রথম ২০টি: % ms',round(extract(epoch from clock_timestamp()-started)*1000);
  loop
    page:=public.read_contact_share_payments(repeat('a',64),'bill',1,offset_value,20);
    assert (page->>'revision')::integer=1 and page->>'key'='bill' and (page->>'total')::integer=500;
    assert jsonb_array_length(page->'payments')<=20;
    if offset_value=0 then assert page->'payments'=detail->'payments'; end if;
    for row in select value from jsonb_array_elements(page->'payments') loop
      assert not(row->>'key'=any(all_keys));
      all_keys:=array_append(all_keys,row->>'key'); amount:=amount+(row->>'paid')::numeric;
    end loop;
    exit when page->>'nextOffset' is null;
    assert (page->>'nextOffset')::integer=offset_value+20;
    offset_value:=(page->>'nextOffset')::integer;
  end loop;
  assert cardinality(all_keys)=500 and amount=50000;
  assert jsonb_array_length(public.read_contact_share_payments(repeat('a',64),'bill',1,500,20)->'payments')=0;
  assert public.read_contact_share_payments(repeat('a',64),'unrelated',1,0,20) is null;
  assert public.read_contact_share_payments(repeat('c',64),'bill',1,0,20) is null;
  assert public.read_contact_share_payments('invalid','bill',1,0,20) is null;
  assert public.read_contact_share_payments(repeat('a',64),'paid-0',1,0,20) is null;
  assert public.read_contact_share_payments(repeat('a',64),'missing',1,0,20) is null;
  assert public.read_contact_share_payments(repeat('a',64),'bill',null,0,20) is null;
  begin perform public.read_contact_share_payments(repeat('a',64),'bill',2,0,20);
    raise exception 'revision_guard_missing';
  exception when others then assert sqlerrm='share_changed'; end;
  begin perform public.read_contact_share_payments(repeat('a',64),'bill',1,0,21);
    raise exception 'page_guard_missing';
  exception when others then assert sqlerrm='invalid_share_page'; end;
  begin perform public.read_contact_share_payments(repeat('a',64),'bill',1,-1,20);
    raise exception 'offset_guard_missing';
  exception when others then assert sqlerrm='invalid_share_page'; end;
  page:=public.read_contact_share_payments(repeat('a',64),'split',1,0,20);
  assert (page->>'total')::integer=1 and (page#>>'{payments,0,paid}')::numeric=100;
  assert page#>'{payments,0,paymentParts}'='[]'::jsonb and page#>'{payments,0,paymentMethods}'='[]'::jsonb;
  result:=public.read_contact_share_activity(repeat('a',64),0,20,1,'paid-499',null);
  assert (result->>'total')::integer=1 and result#>>'{rows,0,key}'='bill';
  raise notice 'পরিশোধের সব পাতা, মোট, অনুমতি ও আলাদা খাতার সুরক্ষা পাস';
end $$;
reset role;
rollback;
select 'fixtures_remaining',count(*) from auth.users where id in ('${owner}','${largeOwner}');
`;
const result = execFileSync(
  "docker",
  [
    "exec",
    "-i",
    "supabase_db_bari-khata",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-At",
    "-f",
    "-",
  ],
  { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 },
);
assert.match(result, /fixtures_remaining\|0/);
console.log(result);
console.log(
  "স্থানীয় শেয়ার পড়ার সীমা ও নিরাপত্তার পরীক্ষা পাস; পরীক্ষার সব তথ্য ফিরিয়ে নেওয়া হয়েছে।",
);

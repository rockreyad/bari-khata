import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LedgerSchema } from "../src/domain/model";

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
    { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const owner = randomUUID();
const token = randomBytes(32).toString("hex");
const scopedToken = randomBytes(32).toString("hex");
const statuses = ["planned", "ongoing", "done", null] as const;
const ledger = LedgerSchema.parse({
  project: { name: "নমুনা কাজের অবস্থা" },
  works: [
    { id: "roof", name: "নমুনা ছাদ" },
    { id: "floor", name: "private-floor" },
  ],
  people: [
    {
      id: "worker",
      name: "নমুনা মিস্ত্রি",
      kind: "worker",
      phone: "private-phone",
    },
    { id: "other", name: "private-worker", kind: "worker" },
  ],
  contracts: [
    ...statuses.map((status, index) => ({
      id: `job-${index}`,
      personId: "worker",
      workId: "roof",
      title: `নমুনা কাজ ${index}`,
      status,
      total: 10000,
      notes: "private-contract-notes",
    })),
    {
      id: "other-job",
      personId: "other",
      workId: "roof",
      title: "private-other-job",
      status: "done",
      total: 10000,
    },
    {
      id: "floor-job",
      personId: "worker",
      workId: "floor",
      title: "private-floor-job",
      status: "ongoing",
      total: 10000,
    },
  ],
  entries: [
    {
      id: "payment",
      kind: "payment",
      account: "labour",
      personId: "worker",
      contractId: "job-0",
      date: "2026-11-06",
      allocations: [{ workId: "roof", amount: 10000 }],
      paymentParts: [{ method: "cash", amount: 10000 }],
    },
  ],
});
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611060003_shared_contract_status.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
const fingerprint = () =>
  db(
    "select md5(pg_get_functiondef(p.oid))||':'||coalesce(p.proacl::text,'') from pg_proc p where p.oid='public.read_contact_share(text,integer,integer,bigint,text)'::regprocedure;",
  );
const before = fingerprint();
const share = (value: string, work: string | null) =>
  `insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash,revoked_at) values (${quote(owner)}::uuid,'worker','labour',${work ? quote(work) : "null"},encode(extensions.digest(${quote(value)},'sha256'),'hex'),null);`;
const sql = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='30s';",
  `insert into auth.users(id,email) values (${quote(owner)}::uuid,${quote(`contract-status-${owner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(ledger)});`,
  share(token, null),
  share(scopedToken, "roof"),
  `create temp table status_before as select public.read_contact_share(${quote(token)},0,20,1,null) response; grant select on status_before to anon;`,
  migration,
  "set local role anon;",
  `do $checks$ declare result jsonb; normalized jsonb; contracts jsonb; entry jsonb; expected jsonb:='["planned","ongoing","done",null]'::jsonb; i integer; begin
    result:=public.read_contact_share(${quote(token)},0,20,1,null);
    select jsonb_agg(value-'status' order by ord) into contracts from jsonb_array_elements(result->'contracts') with ordinality parts(value,ord);
    normalized:=jsonb_set(result,'{contracts}',contracts);
    if normalized<>(select jsonb_set(response,'{contracts}',(select jsonb_agg(value-'status' order by ord) from jsonb_array_elements(response->'contracts') with ordinality parts(value,ord))) from status_before) then raise exception 'non_status_response_changed'; end if;
    for i in 0..3 loop
      select value into entry from jsonb_array_elements(result->'contracts') where value->>'title'='নমুনা কাজ '||i;
      if not entry ? 'status' or entry->'status' is distinct from expected->i then raise exception 'stored_status_missing_%',i; end if;
    end loop;
    if result::text like '%private-other%' or result::text like '%private-contract%' or result::text like '%private-phone%' or result::text like '%private-worker%' then raise exception 'private_metadata_leaked'; end if;
    result:=public.read_contact_share_activity(${quote(scopedToken)},0,20,1,null,null);
    if jsonb_array_length(result->'contracts')<>4 or result::text like '%private-floor%' then raise exception 'work_scope_leaked'; end if;
    if not (result#>'{contracts,0}') ? 'status' then raise exception 'activity_status_missing'; end if;
    if public.read_contact_share(repeat('f',64),0,20,null,null) is not null then raise exception 'invalid_token_accepted'; end if;
  end; $checks$;`,
  "reset role; select 'shared_contract_status_rollback_passed'; rollback;",
].join("\n");
try {
  assert.equal(db(sql), "shared_contract_status_rollback_passed");
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
  "স্থানীয় Supabase: কাজের আসল অবস্থা, টাকার হিসাব অক্ষত থাকা, কাজের পরিসর, গোপনীয়তা ও rollback যাচাই সফল।\n",
);

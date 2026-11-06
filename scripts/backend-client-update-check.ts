import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
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
    {
      encoding: "utf8",
    },
  ),
  /supabase\/postgres:/,
);
function db(sql: string) {
  try {
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
        maxBuffer: 4 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
  } catch (error) {
    throw new Error(String((error as { stderr?: unknown }).stderr ?? error));
  }
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const policy = z
  .object({
    minimumSupportedVersion: z
      .string()
      .regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/),
  })
  .strict()
  .parse(
    JSON.parse(
      readFileSync(new URL("../release-policy.json", import.meta.url), "utf8"),
    ),
  );
assert.equal(policy.minimumSupportedVersion, "0.1.4");
const migration = (name: string) => {
  const sql = readFileSync(
    new URL(`../supabase/migrations/${name}`, import.meta.url),
    "utf8",
  )
    .trim()
    .replace(/^begin;\s*/i, "")
    .replace(/\s*commit;$/i, "");
  assert.doesNotMatch(sql, /^\s*(?:begin|commit|rollback)\s*;/im);
  return sql;
};
const fingerprint = () =>
  db(`select jsonb_build_object(
  'functions',(select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),'|' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')),
  'policies',(select md5(string_agg(row_to_json(p)::text,'|' order by p.oid)) from pg_policy p where polrelid in ('public.ledger_documents'::regclass,'public.ledger_operations'::regclass,'storage.objects'::regclass)),
  'triggers',(select md5(string_agg(pg_get_triggerdef(oid),'|' order by oid)) from pg_trigger where tgrelid='public.ledger_documents'::regclass),
  'constraints',(select md5(string_agg(pg_get_constraintdef(oid),'|' order by oid)) from pg_constraint where conrelid='public.ledger_documents'::regclass),
  'documents',(select md5(string_agg(md5(row_to_json(d)::text),'|' order by owner_id)) from public.ledger_documents d),
  'operations',(select md5(string_agg(md5(row_to_json(o)::text),'|' order by owner_id,request_id)) from public.ledger_operations o),
  'receipts',(select md5(string_agg(md5(row_to_json(o)::text),'|' order by id)) from storage.objects o),
  'buckets',(select md5(string_agg(md5(row_to_json(b)::text),'|' order by id)) from storage.buckets b)
);`);
const before = fingerprint();
const owner = randomUUID();
const otherBucket = `update-check-${randomUUID()}`;
const prefix = `${owner}/synthetic-update-check`;
const document = LedgerSchema.parse({
  architectureVersion: 2,
  works: [{ id: "work", name: "নমুনা কাজ" }],
  people: [{ id: "shop", name: "নমুনা দোকান", roles: ["supplier"] }],
  entries: [
    {
      id: "bill",
      kind: "expense",
      personId: "shop",
      account: "materials",
      lines: [
        { id: "line", workId: "work", label: "নমুনা মাল", amount: 10000 },
      ],
    },
  ],
  paymentAllocations: [],
});
const unsupportedHeaders = [
  "",
  "{}",
  "null",
  "[]",
  "not-json",
  ...[
    "",
    "0.1.3",
    "0.0.99",
    "0.1.03",
    "0.1",
    "-1.2.3",
    "banana",
    "0.1.4-rc.1",
    "0.1.4+build",
    " 0.1.4",
    "0.1.4,0.1.3",
    "9".repeat(65),
  ].map((version) => JSON.stringify({ "x-bari-client-version": version })),
];
const authenticatedClaims = json({ sub: owner, role: "authenticated" });
const chunks = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='30s'; set local idle_in_transaction_session_timeout='30s'; set local client_min_messages='warning';",
  "create temporary table original_save_body as select prosrc,proconfig,prosecdef from pg_proc where oid='public.save_ledger_snapshot(uuid,bigint,jsonb)'::regprocedure;",
];
if (
  db(
    "select to_regprocedure('private.strip_retired_work_metadata(jsonb)') is null;",
  ) === "t"
) {
  chunks.push(migration("202611060001_remove_work_milestones.sql"));
}
if (
  db(
    "select to_regprocedure('private.minimum_supported_client_version()') is null;",
  ) === "t"
) {
  chunks.push(migration("202611060002_require_client_update.sql"));
} else {
  chunks[1] =
    "create temporary table original_save_body as select prosrc,proconfig,prosecdef from pg_proc where oid='private.save_ledger_snapshot_before_update_gate(uuid,bigint,jsonb)'::regprocedure;";
}
chunks.push(
  `do $permissions$ begin
    if private.minimum_supported_client_version()<>${quote(policy.minimumSupportedVersion)} then raise exception 'release_policy_sql_minimum_mismatch'; end if;
    if not exists(select 1 from pg_proc p join original_save_body b on p.prosrc=b.prosrc and p.proconfig=b.proconfig and p.prosecdef=b.prosecdef where p.oid='private.save_ledger_snapshot_before_update_gate(uuid,bigint,jsonb)'::regprocedure) then raise exception 'original_financial_rpc_body_changed'; end if;
    if has_function_privilege('authenticated','private.save_ledger_snapshot_before_update_gate(uuid,bigint,jsonb)','EXECUTE') or has_function_privilege('anon','private.save_ledger_snapshot_before_update_gate(uuid,bigint,jsonb)','EXECUTE') or has_function_privilege('service_role','private.save_ledger_snapshot_before_update_gate(uuid,bigint,jsonb)','EXECUTE') then raise exception 'private_helper_is_callable'; end if;
    if not has_function_privilege('authenticated','public.save_ledger_snapshot(uuid,bigint,jsonb)','EXECUTE') or not has_function_privilege('service_role','public.save_ledger_snapshot(uuid,bigint,jsonb)','EXECUTE') or has_function_privilege('anon','public.save_ledger_snapshot(uuid,bigint,jsonb)','EXECUTE') then raise exception 'rpc_grants_changed'; end if;
    if not private.client_version_is_supported('0.1.10') or not private.client_version_is_supported('0.10.0') or not private.client_version_is_supported('1.0.0') or private.client_version_is_supported('0.1.3') then raise exception 'numeric_version_comparison_failed'; end if;
    if exists(select 1 from pg_policy where polrelid='storage.objects'::regclass and polname like 'receipt_current_client_%' and (polcmd='r' or polpermissive)) then raise exception 'storage_gate_grants_read_or_write'; end if;
  end; $permissions$;`,
  `insert into auth.users(id,email) values (${quote(owner)}::uuid,${quote(`${owner}@example.invalid`)});
  insert into storage.buckets(id,name,public) values (${quote(otherBucket)},${quote(otherBucket)},false);
  insert into storage.objects(bucket_id,name,owner_id) select bucket,${quote(prefix)},${quote(owner)} from unnest(array['bari-receipts','bari-mcp-staging',${quote(otherBucket)}]) bucket;
  create policy synthetic_update_check on storage.objects for all to authenticated
    using (bucket_id in ('bari-mcp-staging',${quote(otherBucket)}) and (storage.foldername(name))[1]=(select auth.uid())::text)
    with check (bucket_id in ('bari-mcp-staging',${quote(otherBucket)}) and (storage.foldername(name))[1]=(select auth.uid())::text);`,
  `select set_config('request.jwt.claims',${authenticatedClaims}::text,true);
  select set_config('request.jwt.claim.sub',${quote(owner)},true);
  select set_config('request.jwt.claim.role','authenticated',true);
  set local role authenticated;`,
  `do $browser$ declare
    headers text; result jsonb; message text; detail text; rejected boolean;
    stored jsonb; operations jsonb; revision bigint:=0; request uuid;
    input jsonb:=${json(document)};
  begin
    perform set_config('request.headers','{"x-bari-client-version":"0.1.4"}',true);
    result:=public.save_ledger_snapshot(gen_random_uuid(),0,input);
    if result->>'status'<>'saved' or result->>'revision'<>'1' then raise exception 'current_browser_save_failed'; end if;
    revision:=1;
    select to_jsonb(d) into stored from public.ledger_documents d where owner_id=${quote(owner)}::uuid;
    select jsonb_agg(to_jsonb(o) order by request_id) into operations from public.ledger_operations o where owner_id=${quote(owner)}::uuid;
    foreach headers in array array[${unsupportedHeaders.map(quote).join(",")}] loop
      perform set_config('request.headers',headers,true);
      rejected:=false;
      begin perform public.save_ledger_snapshot(gen_random_uuid(),revision,input);
      exception when sqlstate 'PT426' then
        get stacked diagnostics message=message_text,detail=pg_exception_detail;
        if message<>'client_update_required' or detail::jsonb<>jsonb_build_object('minimumSupportedVersion',${quote(policy.minimumSupportedVersion)}) then raise exception 'wrong_update_required_contract'; end if;
        rejected:=true;
      end;
      if not rejected then raise exception 'unsupported_client_wrote_ledger: %',headers; end if;
      if (select to_jsonb(d) from public.ledger_documents d where owner_id=${quote(owner)}::uuid)<>stored or (select jsonb_agg(to_jsonb(o) order by request_id) from public.ledger_operations o where owner_id=${quote(owner)}::uuid)<>operations then raise exception 'rejection_changed_financial_data_or_hash'; end if;
      if public.load_ledger_snapshot()->'document'<>input then raise exception 'old_browser_cannot_read_backup'; end if;
    end loop;
    foreach headers in array array['0.1.4','0.1.10','0.10.0','1.0.0'] loop
      perform set_config('request.headers',jsonb_build_object('x-bari-client-version',headers)::text,true);
      request:=gen_random_uuid();
      result:=public.save_ledger_snapshot(request,revision,input);
      revision:=revision+1;
      if result->>'status'<>'saved' or (result->>'revision')::bigint<>revision then raise exception 'supported_version_rejected'; end if;
      result:=public.save_ledger_snapshot(request,revision-1,input);
      if (result->>'revision')::bigint<>revision or (select payload_hash from public.ledger_operations where owner_id=${quote(owner)}::uuid and request_id=request)<>md5(input::text) then raise exception 'idempotency_or_payload_hash_changed'; end if;
    end loop;
    rejected:=false;
    begin perform public.save_ledger_snapshot(request,revision,jsonb_set(input,'{entries,0,note}','"পরীক্ষার নতুন লেখা"'::jsonb));
    exception when others then if sqlerrm='operation_payload_mismatch' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'payload_mismatch_was_not_rejected'; end if;
    result:=public.save_ledger_snapshot(gen_random_uuid(),0,input);
    if result->>'status'<>'conflict' or result->'document'<>input then raise exception 'existing_conflict_behavior_changed'; end if;
    rejected:=false;
    begin perform public.save_ledger_snapshot(gen_random_uuid(),revision,jsonb_set(input,'{entries,0,lines,0,amount}','-1'::jsonb));
    exception when check_violation then rejected:=true; end;
    if not rejected or public.load_ledger_snapshot()->'document'<>input then raise exception 'financial_validation_changed'; end if;
    rejected:=false;
    begin perform private.save_ledger_snapshot_before_update_gate(gen_random_uuid(),revision,input);
    exception when insufficient_privilege then rejected:=true; end;
    if not rejected then raise exception 'browser_bypassed_wrapper'; end if;
  end; $browser$;`,
  `do $storage$ declare bucket text; operation text; rejected boolean; changed integer; message text; detail text; stored jsonb; headers text;
  begin
    perform set_config('storage.allow_delete_query','true',true);
    foreach bucket in array array['bari-receipts','bari-mcp-staging'] loop
      select to_jsonb(o) into stored from storage.objects o where bucket_id=bucket and name=${quote(prefix)};
      foreach headers in array array['{}','{"x-bari-client-version":"0.1.3"}'] loop
        perform set_config('request.headers',headers,true);
        if (select count(*) from storage.objects where bucket_id=bucket and name=${quote(prefix)})<>1 then raise exception 'receipt_read_blocked'; end if;
        foreach operation in array array['insert','update','delete'] loop
          rejected:=false;
          begin
            if operation='insert' then insert into storage.objects(bucket_id,name,owner_id) values(bucket,${quote(`${prefix}-new`)},${quote(owner)});
            elsif operation='update' then update storage.objects set name=name||'-changed' where bucket_id=bucket and name=${quote(prefix)};
            else delete from storage.objects where bucket_id=bucket and name=${quote(prefix)}; end if;
          exception when sqlstate 'PT426' then
            get stacked diagnostics message=message_text,detail=pg_exception_detail;
            if message<>'client_update_required' or detail::jsonb<>jsonb_build_object('minimumSupportedVersion',${quote(policy.minimumSupportedVersion)}) then raise exception 'wrong_storage_update_contract'; end if;
            rejected:=true;
          end;
          if not rejected then raise exception 'old_receipt_write_allowed: % %',bucket,operation; end if;
          if (select to_jsonb(o) from storage.objects o where bucket_id=bucket and name=${quote(prefix)})<>stored then raise exception 'rejected_receipt_changed'; end if;
        end loop;
      end loop;
      perform set_config('request.headers','{"x-bari-client-version":"0.1.4"}',true);
      insert into storage.objects(bucket_id,name,owner_id) values(bucket,${quote(`${prefix}-new`)},${quote(owner)});
      update storage.objects set name=name||'-changed' where bucket_id=bucket and name=${quote(`${prefix}-new`)};
      get diagnostics changed=row_count;
      if changed<>1 then raise exception 'current_receipt_update_failed'; end if;
      delete from storage.objects where bucket_id=bucket and name=${quote(`${prefix}-new-changed`)};
      get diagnostics changed=row_count;
      if changed<>1 then raise exception 'current_receipt_delete_failed'; end if;
    end loop;
    perform set_config('request.headers','{}',true);
    insert into storage.objects(bucket_id,name,owner_id) values(${quote(otherBucket)},${quote(`${prefix}-new`)},${quote(owner)});
    update storage.objects set name=name||'-changed' where bucket_id=${quote(otherBucket)} and name=${quote(`${prefix}-new`)};
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'unrelated_bucket_update_blocked'; end if;
    delete from storage.objects where bucket_id=${quote(otherBucket)} and name=${quote(`${prefix}-new-changed`)};
    get diagnostics changed=row_count;
    if changed<>1 then raise exception 'unrelated_bucket_delete_blocked'; end if;
  end; $storage$; reset role;`,
  `select set_config('request.jwt.claims',${json({ sub: owner, role: "service_role" })}::text,true);
  select set_config('request.jwt.claim.role','service_role',true);
  set local role service_role;
  do $trusted$ declare result jsonb; begin
    perform set_config('request.headers','{}',true);
    result:=public.save_ledger_snapshot(gen_random_uuid(),5,${json(document)});
    if result->>'status'<>'saved' or result->>'revision'<>'6' then raise exception 'service_role_blocked'; end if;
    if public.mcp_server('rate_limit',jsonb_build_object('key',repeat('a',64),'limit',2,'windowSeconds',60))->>'allowed'<>'true' then raise exception 'mcp_service_role_changed'; end if;
    insert into storage.objects(bucket_id,name,owner_id) values('bari-mcp-staging',${quote(`${prefix}-service`)},${quote(owner)});
  end; $trusted$; reset role;
  select 'client_update_rollback_passed'; rollback;`,
);
try {
  const output = db(chunks.join("\n"));
  assert.equal(output.split("\n").at(-1), "client_update_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    before,
    "পরীক্ষার পরে হিসাব, hash, function, অনুমতি ও রসিদ আগের মতো থাকতে হবে।",
  );
  assert.equal(
    db(
      `select not exists(select 1 from auth.users where id=${quote(owner)}::uuid) and not exists(select 1 from storage.buckets where id=${quote(otherBucket)});`,
    ),
    "t",
  );
}

const apiConfig = readFileSync(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
)
  .split(/\r?\n(?=\[[^\]\r\n]+\])/)
  .find((section) => /^\[api\]\r?\n/.test(section));
assert.ok(apiConfig, "স্থানীয় API-এর configuration থাকতে হবে।");
const apiPort = Number(apiConfig.match(/^port\s*=\s*(\d+)\s*$/m)?.[1]);
assert.ok(Number.isInteger(apiPort) && apiPort > 0 && apiPort < 65536);
for (const path of [
  "/rest/v1/rpc/save_ledger_snapshot",
  "/storage/v1/object/bari-receipts/synthetic-update-check",
]) {
  const headers = execFileSync(
    "curl",
    [
      "--noproxy",
      "*",
      "--max-time",
      "5",
      "-sS",
      "-D",
      "-",
      "-o",
      "/dev/null",
      "-X",
      "OPTIONS",
      "-H",
      "Origin: http://localhost:5180",
      "-H",
      "Access-Control-Request-Method: POST",
      "-H",
      "Access-Control-Request-Headers: authorization,apikey,content-type,x-bari-client-version",
      `http://127.0.0.1:${apiPort}${path}`,
    ],
    { encoding: "utf8" },
  );
  assert.match(headers, /^HTTP\/\S+ 2\d\d/m);
  assert.match(
    headers,
    /^access-control-allow-headers:.*(?:\*|x-bari-client-version)/im,
  );
}
console.log(
  "স্থানীয় update পরীক্ষা সফল: পুরোনো/ভুল সংস্করণ বন্ধ, পড়া ও ব্যাকআপ খোলা, বর্তমান/পরের সংস্করণ ও service role চালু, আগের হিসাব/hash/সংঘর্ষ অক্ষত, দুই রসিদের bucket-এ write guard, অন্য bucket অক্ষত, CORS এবং সম্পূর্ণ rollback।",
);

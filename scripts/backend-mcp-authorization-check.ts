import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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
    { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  ).trim();
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const signatures = [
  "public.mcp_server(text,jsonb)",
  "private.mcp_server_before_authorization_lifecycle(text,jsonb)",
  "private.mcp_connection_json(private.mcp_connections)",
];
const fingerprint = () =>
  db(`select jsonb_build_object(
    'functions',(select jsonb_object_agg(name,coalesce(md5(pg_get_functiondef(to_regprocedure(name))),'absent')) from unnest(array[${signatures.map(quote).join(",")}]) name),
    'lastUsedColumn',exists(select 1 from information_schema.columns where table_schema='private' and table_name='mcp_connections' and column_name='last_used_at'),
    'flowIndex',to_regclass('private.mcp_authorizations_flow') is not null);`);
const original = fingerprint();
assert.equal(
  db("select to_regprocedure('public.mcp_server(text,jsonb)') is not null;"),
  "t",
  "আগের স্থানীয় MCP migration আগে প্রয়োগ করুন।",
);
const installed =
  db(
    "select to_regprocedure('private.mcp_server_before_authorization_lifecycle(text,jsonb)') is not null;",
  ) === "t";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611040004_mcp_authorization_lifecycle.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const owner = randomUUID();
const statements = [
  "begin; set local lock_timeout='3s'; set local statement_timeout='30s'; set local idle_in_transaction_session_timeout='60s';",
  ...(installed ? [] : [migration]),
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`mcp-lifecycle-${owner}@example.invalid`)});`,
  `create function pg_temp.expect_mcp_error(p_action text,p_data jsonb,p_message text) returns void language plpgsql as $expected$
  declare rejected boolean:=false;
  begin
    begin perform public.mcp_server(p_action,p_data);
    exception when others then if sqlerrm=p_message then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_expected_error_missing: % / %',p_action,p_message; end if;
  end; $expected$;`,
  `do $checks$
  declare
    own uuid:=${quote(owner)}::uuid; req uuid:=gen_random_uuid(); conn uuid; unused_conn uuid;
    client text:='synthetic-lifecycle-'||own::text; second_client text:='synthetic-lifecycle-other-'||own::text;
    flow jsonb; consent jsonb; exchange jsonb; result jsonb; second jsonb; usage timestamptz; started timestamptz:=clock_timestamp();
  begin
    if not has_function_privilege('service_role','public.mcp_server(text,jsonb)','execute')
      or has_function_privilege('anon','public.mcp_server(text,jsonb)','execute')
      or has_function_privilege('authenticated','public.mcp_server(text,jsonb)','execute')
      or has_function_privilege('service_role','private.mcp_server_before_authorization_lifecycle(text,jsonb)','execute')
      then raise exception 'mcp_lifecycle_rpc_permissions'; end if;
    perform public.mcp_server('register_client',jsonb_build_object('clientId',client,'clientName','একই নামের সহকারী','redirectUris',jsonb_build_array('https://assistant.example.invalid/callback'),'scope','ledger:read entries:create'));
    flow:=jsonb_build_object('clientId',client,'requestId',req,'redirectUri','https://assistant.example.invalid/callback','scopes',jsonb_build_array('ledger:read','entries:create'),'codeChallenge',repeat('A',43),'resource','https://app.example.invalid/api/mcp','state','same-flow');
    result:=public.mcp_server('begin_authorization',flow);
    second:=public.mcp_server('begin_authorization',flow||jsonb_build_object('requestId',gen_random_uuid(),'scopes',jsonb_build_array('entries:create','ledger:read')));
    if result->>'requestId' is distinct from second->>'requestId' or result->>'expiresAt' is distinct from second->>'expiresAt'
      or (select count(*) from private.mcp_authorizations where client_id=client)<>1 then raise exception 'mcp_authorization_retry_created_request'; end if;
    perform pg_temp.expect_mcp_error('begin_authorization',flow||jsonb_build_object('requestId',gen_random_uuid(),'scopes',jsonb_build_array('ledger:read')),'mcp_invalid_scope');
    consent:=jsonb_build_object('ownerId',own,'requestId',req,'name','একই নামের সহকারী','scopes',jsonb_build_array('ledger:read'),'policy',jsonb_build_object('confirmationRequired',true),'codeHash',repeat('5',64));
    result:=public.mcp_server('approve_authorization',consent);
    conn:=(result->>'connectionId')::uuid;
    perform pg_temp.expect_mcp_error('approve_authorization',consent||jsonb_build_object('scopes',jsonb_build_array('ledger:read','entries:create'),'policy','{}'::jsonb,'codeHash',repeat('6',64)),'mcp_invalid_grant');
    result:=public.mcp_server('begin_authorization',flow||jsonb_build_object('requestId',gen_random_uuid()));
    if result->>'requestId' is distinct from req::text
      or (select count(*) from private.mcp_connections where client_id=client)<>1
      or (select count(*) from private.mcp_codes where client_id=client)<>1
      or (select scopes from private.mcp_connections where id=conn)<>array['ledger:read']
      or (select policy from private.mcp_connections where id=conn)<>jsonb_build_object('confirmationRequired',true)
      then raise exception 'mcp_authorization_retry_changed_grant'; end if;
    perform pg_temp.expect_mcp_error('authorization_details',jsonb_build_object('requestId',req),'mcp_not_found');
    if (select last_used_at from private.mcp_connections where id=conn) is not null then raise exception 'mcp_creation_invented_usage'; end if;

    result:=public.mcp_server('begin_authorization',flow||jsonb_build_object('requestId',gen_random_uuid(),'state','different-state'));
    if result->>'requestId'=req::text then raise exception 'mcp_authorization_combined_states'; end if;
    result:=public.mcp_server('begin_authorization',flow||jsonb_build_object('requestId',gen_random_uuid(),'codeChallenge',repeat('B',43)));
    if result->>'requestId'=req::text then raise exception 'mcp_authorization_combined_pkce'; end if;
    perform public.mcp_server('register_client',jsonb_build_object('clientId',second_client,'clientName','একই নামের সহকারী','redirectUris',jsonb_build_array('https://assistant.example.invalid/callback'),'scope','ledger:read entries:create'));
    result:=public.mcp_server('begin_authorization',flow||jsonb_build_object('requestId',gen_random_uuid(),'clientId',second_client));
    result:=public.mcp_server('approve_authorization',consent||jsonb_build_object('requestId',result->>'requestId','codeHash',repeat('7',64)));
    unused_conn:=(result->>'connectionId')::uuid;
    if unused_conn=conn then raise exception 'mcp_authorization_combined_clients'; end if;

    exchange:=jsonb_build_object('codeHash',repeat('5',64),'clientId',client,'redirectUri','https://assistant.example.invalid/callback','codeChallenge',repeat('A',43),'resource','https://app.example.invalid/api/mcp','accessHash',repeat('1',64),'refreshHash',repeat('2',64));
    perform pg_temp.expect_mcp_error('exchange_code',exchange||jsonb_build_object('codeChallenge',repeat('X',43)),'mcp_invalid_grant');
    perform public.mcp_server('exchange_code',exchange);
    perform pg_temp.expect_mcp_error('exchange_code',exchange,'mcp_invalid_grant');
    perform pg_temp.expect_mcp_error('authenticate',jsonb_build_object('tokenHash',repeat('1',64),'resource','https://wrong.example.invalid/api/mcp'),'mcp_unauthorized');
    if (select last_used_at from private.mcp_connections where id=conn) is not null then raise exception 'mcp_denied_request_recorded_usage'; end if;
    result:=public.mcp_server('authenticate',jsonb_build_object('tokenHash',repeat('1',64),'resource','https://app.example.invalid/api/mcp'));
    usage:=(result#>>'{connection,lastUsedAt}')::timestamptz;
    if usage is null or usage<started or result#>>'{connection,createdAt}' is null then raise exception 'mcp_successful_usage_not_recorded'; end if;
    result:=public.mcp_server('list_connections',jsonb_build_object('ownerId',own));
    if not exists(select 1 from jsonb_array_elements(result->'connections') c where c->>'id'=conn::text and (c->>'lastUsedAt')::timestamptz=usage)
      or not exists(select 1 from jsonb_array_elements(result->'connections') c where c->>'id'=unused_conn::text and c->'lastUsedAt'='null'::jsonb)
      then raise exception 'mcp_connection_usage_metadata_missing'; end if;
    perform public.mcp_server('revoke_connection',jsonb_build_object('ownerId',own,'connectionId',conn));
    perform pg_temp.expect_mcp_error('authenticate',jsonb_build_object('tokenHash',repeat('1',64),'resource','https://app.example.invalid/api/mcp'),'mcp_unauthorized');
    if (select last_used_at from private.mcp_connections where id=conn) is distinct from usage then raise exception 'mcp_revoked_request_changed_usage'; end if;
  end; $checks$;`,
  "select 'mcp-authorization-lifecycle-ok'; rollback;",
];
assert.equal(db(statements.join("\n")), "mcp-authorization-lifecycle-ok");
assert.equal(fingerprint(), original);
console.log(
  "MCP-এর একই অনুমতির অনুরোধ, একবারের অনুমোদন, আলাদা সংযোগ ও শেষ ব্যবহারের সময় ঠিক আছে; সব পরীক্ষার পরিবর্তন rollback হয়েছে।",
);

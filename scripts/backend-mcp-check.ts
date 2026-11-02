import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
    {
      encoding: "utf8",
    },
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
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const signatures = [
  "public.load_ledger_snapshot()",
  "public.save_ledger_snapshot(uuid,bigint,jsonb)",
  "public.ledger_evolution_is_valid(jsonb,jsonb)",
  "public.mcp_server(text,jsonb)",
];
const fingerprint = () =>
  db(
    `select jsonb_object_agg(name,coalesce(md5(pg_get_functiondef(to_regprocedure(name))),'absent')) from unnest(array[${signatures.map(quote).join(",")}]) name;`,
  );
const original = fingerprint();
const installed =
  db("select to_regprocedure('public.mcp_server(text,jsonb)') is not null;") ===
  "t";
assert.equal(
  db(
    "select to_regprocedure('public.ledger_removals_are_valid(jsonb)') is not null;",
  ),
  "t",
  "আগের স্থানীয় migration-গুলো আগে প্রয়োগ করুন।",
);
const migration = readFileSync(
  new URL("../supabase/migrations/202611020007_mcp.sql", import.meta.url),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const owner = randomUUID();
const otherOwner = randomUUID();
const empty = LedgerSchema.parse({
  works: [{ id: "synthetic-work", name: "পরীক্ষার কাজ" }],
  people: [{ id: "synthetic-shop", name: "পরীক্ষার দোকান", kind: "shop" }],
});
const withEntry = (id: string, amount = 50000) => ({
  id,
  kind: "expense" as const,
  account: "materials" as const,
  personId: "synthetic-shop",
  date: "2026-11-02",
  lines: [
    {
      id: `${id}-line`,
      workId: "synthetic-work",
      costType: "material",
      amount,
    },
  ],
});
const first = LedgerSchema.parse({
  ...empty,
  entries: [withEntry("synthetic-one")],
});
const second = LedgerSchema.parse({
  ...first,
  entries: [...first.entries, withEntry("synthetic-two")],
});
const third = LedgerSchema.parse({
  ...second,
  entries: [...second.entries, withEntry("synthetic-three")],
});
const fourth = LedgerSchema.parse({
  ...third,
  entries: [...third.entries, withEntry("synthetic-four")],
});
const fifth = LedgerSchema.parse({
  ...fourth,
  entries: [...fourth.entries, withEntry("synthetic-five")],
});
const scopes = [
  "ledger:read",
  "entries:create",
  "entries:update",
  "entries:void_restore",
  "entities:write",
  "contracts:write",
  "catalog:write",
  "receipts:read",
  "receipts:write",
];
const statements = [
  "begin; set local lock_timeout='3s'; set local statement_timeout='30s'; set local idle_in_transaction_session_timeout='60s';",
  ...(installed ? [] : [migration]),
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`mcp-${owner}@example.invalid`)}),(${quote(otherOwner)}::uuid,'authenticated','authenticated',${quote(`mcp-${otherOwner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values(${quote(owner)}::uuid,1,${json(empty)});`,
  `create function pg_temp.expect_mcp_error(p_action text,p_data jsonb,p_message text) returns void language plpgsql as $expected$
  declare rejected boolean:=false;
  begin
    begin perform public.mcp_server(p_action,p_data);
    exception when others then if sqlerrm=p_message then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_expected_error_missing: % / %',p_action,p_message; end if;
  end; $expected$;`,
  `do $mcp_checks$
  declare
    own uuid:=${quote(owner)}::uuid; other_own uuid:=${quote(otherOwner)}::uuid;
    full_scopes jsonb:=${json(scopes)}; base_doc jsonb:=${json(empty)};
    first_doc jsonb:=${json(first)}; second_doc jsonb:=${json(second)}; third_doc jsonb:=${json(third)}; fourth_doc jsonb:=${json(fourth)}; fifth_doc jsonb:=${json(fifth)};
    pat text:=repeat('a',64); read_pat text:=repeat('b',64); other_pat text:=repeat('c',64); limited_pat text:=repeat('d',64); approval_pat text:=repeat('e',64);
    oauth_access text:=repeat('1',64); oauth_refresh text:=repeat('2',64); next_access text:=repeat('3',64); next_refresh text:=repeat('4',64);
    result jsonb; conn uuid; approval_conn uuid; proposal uuid; stale_proposal uuid; payload jsonb; changed jsonb; protected_doc jsonb;
    client text:='synthetic-'||own::text; req uuid:=gen_random_uuid(); oauth_conn uuid; rejected boolean; before_count bigint;
  begin
    result:=public.mcp_server('create_connection',jsonb_build_object('ownerId',own,'name','পরীক্ষার সহকারী','scopes',full_scopes,'tokenHash',pat));
    conn:=(result#>>'{connection,id}')::uuid;
    if position(pat in result::text)>0 then raise exception 'mcp_hash_leaked_in_connection'; end if;
    perform public.mcp_server('create_connection',jsonb_build_object('ownerId',own,'name','শুধু দেখা','scopes',jsonb_build_array('ledger:read'),'tokenHash',read_pat));
    perform public.mcp_server('create_connection',jsonb_build_object('ownerId',other_own,'name','অন্যের সহকারী','scopes',full_scopes,'tokenHash',other_pat));
    result:=public.mcp_server('authenticate',jsonb_build_object('tokenHash',other_pat,'ownerId',own));
    if result#>'{snapshot,document}'<>'null'::jsonb or result#>>'{connection,ownerId}'<>other_own::text then raise exception 'mcp_owner_argument_escalated'; end if;
    perform pg_temp.expect_mcp_error('authenticate',jsonb_build_object('tokenHash',repeat('0',64)),'mcp_unauthorized');
    payload:=jsonb_build_object('tokenHash',pat,'requestKey','first','digest',repeat('f',64),'expectedRevision',1,'document',first_doc,'requiredScopes',jsonb_build_array('ledger:read'),'amountPaisa',1,'result',jsonb_build_object('entryId','synthetic-one'));
    perform pg_temp.expect_mcp_error('save',payload||jsonb_build_object('tokenHash',read_pat),'mcp_scope_required');
    result:=public.mcp_server('save',payload||jsonb_build_object('ownerId',other_own));
    if result->>'status'<>'saved' or (result->>'revision')::int<>2 then raise exception 'mcp_first_save_failed'; end if;
    result:=public.mcp_server('save',payload);
    if (result->>'revision')::int<>2 then raise exception 'mcp_retry_duplicated_write'; end if;
    perform pg_temp.expect_mcp_error('save',payload||jsonb_build_object('digest',repeat('0',64)),'mcp_operation_mismatch');
    result:=public.mcp_server('save',payload||jsonb_build_object('requestKey','stale'));
    if result->>'status'<>'conflict' or (result->>'revision')::int<>2 then raise exception 'mcp_stale_write_not_conflict'; end if;
    if result ? 'document' then raise exception 'mcp_conflict_document_leak'; end if;
    result:=public.mcp_server('operation',jsonb_build_object('tokenHash',pat,'requestKey','first'));
    if result#>>'{result,entryId}'<>'synthetic-one' then raise exception 'mcp_operation_result_missing'; end if;
    if public.mcp_server('operation',jsonb_build_object('tokenHash',other_pat,'requestKey','first')) is not null then raise exception 'mcp_cross_owner_operation_leak'; end if;
    changed:=jsonb_set(first_doc,'{entries,0,provenance}','null'::jsonb);
    changed:=jsonb_set(changed,'{entries,0,reviewReason}','""'::jsonb);
    result:=private.mcp_document_changes(first_doc,changed);
    if (result->>'amountPaisa')::int<>0 or result->'requiredScopes'<>jsonb_build_array('ledger:read') then raise exception 'mcp_defaults_misclassified_as_edit'; end if;
    select count(*) into before_count from private.mcp_operations where owner_id=own;
    changed:=jsonb_set(second_doc,'{entries,1,lines,0,amount}','-1'::jsonb);
    perform pg_temp.expect_mcp_error('save',payload||jsonb_build_object('requestKey','invalid','expectedRevision',2,'document',changed),'mcp_invalid_document');
    if (select count(*) from private.mcp_operations where owner_id=own)<>before_count or (select revision from public.ledger_documents where owner_id=own)<>2 then raise exception 'mcp_failed_write_not_atomic'; end if;
    perform public.mcp_server('create_connection',jsonb_build_object('ownerId',own,'name','সীমিত সহকারী','scopes',full_scopes,'tokenHash',limited_pat,'policy',jsonb_build_object('maxAmountPaisa',60000,'maxDailyAmountPaisa',60000,'maxDailyOperations',1)));
    result:=public.mcp_server('save',payload||jsonb_build_object('tokenHash',limited_pat,'requestKey','limited-one','expectedRevision',2,'document',second_doc));
    if result->>'status'<>'saved' then raise exception 'mcp_scoped_save_failed'; end if;
    perform pg_temp.expect_mcp_error('save',payload||jsonb_build_object('tokenHash',limited_pat,'requestKey','limited-two','expectedRevision',3,'document',third_doc),'mcp_limit_exceeded');
    result:=public.mcp_server('list_audit',jsonb_build_object('tokenHash',other_pat));
    if jsonb_array_length(result->'operations')<>0 then raise exception 'mcp_cross_owner_audit_leak'; end if;
    result:=public.mcp_server('list_audit',jsonb_build_object('tokenHash',pat,'entryId','synthetic-one'));
    if jsonb_array_length(result->'operations')<>1 then raise exception 'mcp_audit_entry_filter_failed'; end if;
    result:=public.mcp_server('list_audit',jsonb_build_object('tokenHash',pat));
    if jsonb_array_length(result->'operations')<>1 then raise exception 'mcp_connection_audit_filter_failed'; end if;
    result:=public.mcp_server('list_audit',jsonb_build_object('tokenHash',pat,'includeAll',true));
    if jsonb_array_length(result->'operations')<>2 then raise exception 'mcp_owner_audit_filter_failed'; end if;
    result:=public.mcp_server('create_connection',jsonb_build_object('ownerId',own,'name','আগে অনুমতি','scopes',full_scopes,'tokenHash',approval_pat,'policy',jsonb_build_object('confirmationRequired',true)));
    approval_conn:=(result#>>'{connection,id}')::uuid;
    payload:=payload||jsonb_build_object('tokenHash',approval_pat,'requestKey','approve-one','expectedRevision',3,'document',third_doc);
    perform pg_temp.expect_mcp_error('save',payload,'mcp_confirmation_required');
    result:=public.mcp_server('create_proposal',payload); proposal:=(result->>'proposalId')::uuid;
    result:=public.mcp_server('operation',jsonb_build_object('tokenHash',approval_pat,'requestKey','approve-one'));
    if result->>'status'<>'pending' or (result->>'proposalId')::uuid<>proposal then raise exception 'mcp_pending_operation_not_recoverable'; end if;
    perform pg_temp.expect_mcp_error('commit_proposal',jsonb_build_object('tokenHash',approval_pat,'proposalId',proposal,'requestKey','approve-one'),'mcp_proposal_pending');
    perform pg_temp.expect_mcp_error('approve_proposal',jsonb_build_object('ownerId',other_own,'proposalId',proposal,'approve',true),'mcp_not_found');
    perform public.mcp_server('approve_proposal',jsonb_build_object('ownerId',own,'proposalId',proposal,'approve',true));
    perform pg_temp.expect_mcp_error('commit_proposal',jsonb_build_object('tokenHash',pat,'proposalId',proposal,'requestKey','approve-one'),'mcp_not_found');
    result:=public.mcp_server('commit_proposal',jsonb_build_object('tokenHash',approval_pat,'proposalId',proposal,'requestKey','approve-one'));
    if result->>'status'<>'saved' or (result->>'revision')::int<>4 then raise exception 'mcp_approved_commit_failed'; end if;
    result:=public.mcp_server('commit_proposal',jsonb_build_object('tokenHash',approval_pat,'proposalId',proposal,'requestKey','approve-one'));
    if (result->>'revision')::int<>4 then raise exception 'mcp_approved_commit_replayed'; end if;
    result:=public.mcp_server('create_proposal',payload||jsonb_build_object('requestKey','approve-stale','expectedRevision',4,'document',fourth_doc)); stale_proposal:=(result->>'proposalId')::uuid;
    perform public.mcp_server('approve_proposal',jsonb_build_object('ownerId',own,'proposalId',stale_proposal,'approve',true));
    perform set_config('request.jwt.claims',jsonb_build_object('sub',own,'role','authenticated')::text,true);
    result:=public.save_ledger_snapshot(gen_random_uuid(),4,fourth_doc);
    if result->>'status'<>'saved' or (result->>'revision')::int<>5 then raise exception 'mcp_legacy_app_save_broken'; end if;
    result:=public.mcp_server('commit_proposal',jsonb_build_object('tokenHash',approval_pat,'proposalId',stale_proposal,'requestKey','approve-stale'));
    if result->>'status'<>'conflict' or (result->>'revision')::int<>5 then raise exception 'mcp_stale_approval_overwrote_app'; end if;
    perform public.mcp_server('revoke_connection',jsonb_build_object('ownerId',own,'connectionId',approval_conn));
    perform pg_temp.expect_mcp_error('authenticate',jsonb_build_object('tokenHash',approval_pat),'mcp_unauthorized');
    perform public.mcp_server('create_connection',jsonb_build_object('ownerId',own,'name','একবারে সীমা','scopes',full_scopes,'tokenHash',repeat('7',64),'policy',jsonb_build_object('maxAmountPaisa',1)));
    payload:=payload||jsonb_build_object('tokenHash',repeat('7',64),'requestKey','approve-over-limit','expectedRevision',5,'document',fifth_doc,'amountPaisa',50000);
    perform pg_temp.expect_mcp_error('save',payload,'mcp_limit_exceeded');
    result:=public.mcp_server('create_proposal',payload); proposal:=(result->>'proposalId')::uuid;
    perform public.mcp_server('approve_proposal',jsonb_build_object('ownerId',own,'proposalId',proposal,'approve',true));
    result:=public.mcp_server('commit_proposal',jsonb_build_object('tokenHash',repeat('7',64),'proposalId',proposal,'requestKey','approve-over-limit'));
    if result->>'status'<>'saved' or (result->>'revision')::int<>6 then raise exception 'mcp_owner_cannot_override_per_command_limit'; end if;
    perform public.mcp_server('register_client',jsonb_build_object('clientId',client,'clientName','OAuth পরীক্ষা','redirectUris',jsonb_build_array('https://assistant.example.invalid/callback'),'tokenEndpointAuthMethod','none','scope',array_to_string(array(select jsonb_array_elements_text(full_scopes)),' ')));
    perform pg_temp.expect_mcp_error('begin_authorization',jsonb_build_object('clientId',client,'requestId',req,'redirectUri','https://attacker.example.invalid/callback','scopes',full_scopes,'codeChallenge',repeat('A',43),'resource','https://app.example.invalid/api/mcp'),'mcp_invalid_redirect_uri');
    perform public.mcp_server('begin_authorization',jsonb_build_object('clientId',client,'requestId',req,'redirectUri','https://assistant.example.invalid/callback','scopes',full_scopes,'codeChallenge',repeat('A',43),'resource','https://app.example.invalid/api/mcp','state','preserved-state'));
    result:=public.mcp_server('approve_authorization',jsonb_build_object('ownerId',other_own,'requestId',req,'name','OAuth পরীক্ষা','scopes',full_scopes,'policy','{}'::jsonb,'codeHash',repeat('5',64)));
    oauth_conn:=(result->>'connectionId')::uuid;
    if result->>'state'<>'preserved-state' then raise exception 'mcp_oauth_state_lost'; end if;
    perform public.mcp_server('begin_authorization',jsonb_build_object('clientId',client,'requestId',gen_random_uuid(),'redirectUri','https://assistant.example.invalid/callback','scopes',full_scopes,'codeChallenge',repeat('A',43),'resource','https://app.example.invalid/api/mcp','state','denied-state'));
    select id into req from private.mcp_authorizations where client_id=client and state='denied-state';
    result:=public.mcp_server('deny_authorization',jsonb_build_object('ownerId',own,'requestId',req));
    if result->>'state'<>'denied-state' then raise exception 'mcp_denied_state_lost'; end if;
    perform pg_temp.expect_mcp_error('authorization_details',jsonb_build_object('requestId',req),'mcp_not_found');
    payload:=jsonb_build_object('codeHash',repeat('5',64),'clientId',client,'redirectUri','https://assistant.example.invalid/callback','codeChallenge',repeat('A',43),'resource','https://app.example.invalid/api/mcp','accessHash',oauth_access,'refreshHash',oauth_refresh);
    perform pg_temp.expect_mcp_error('exchange_code',payload||jsonb_build_object('codeChallenge',repeat('B',43)),'mcp_invalid_grant');
    perform public.mcp_server('exchange_code',payload);
    perform pg_temp.expect_mcp_error('exchange_code',payload,'mcp_invalid_grant');
    perform pg_temp.expect_mcp_error('authenticate',jsonb_build_object('tokenHash',oauth_access,'resource','https://other.example.invalid/api/mcp'),'mcp_unauthorized');
    perform pg_temp.expect_mcp_error('authenticate',jsonb_build_object('tokenHash',oauth_refresh),'mcp_unauthorized');
    result:=public.mcp_server('authenticate',jsonb_build_object('tokenHash',oauth_access,'resource','https://app.example.invalid/api/mcp'));
    if result#>>'{connection,ownerId}'<>other_own::text then raise exception 'mcp_oauth_wrong_owner'; end if;
    payload:=jsonb_build_object('refreshHash',oauth_refresh,'clientId',client,'resource','https://app.example.invalid/api/mcp','accessHash',next_access,'newRefreshHash',next_refresh);
    perform public.mcp_server('refresh',payload);
    result:=public.mcp_server('refresh',payload);
    if result->>'error'<>'invalid_grant' then raise exception 'mcp_refresh_reuse_not_detected'; end if;
    perform pg_temp.expect_mcp_error('authenticate',jsonb_build_object('tokenHash',next_access),'mcp_unauthorized');
    payload:=jsonb_build_object('tokenHash',pat,'id','synthetic-receipt','path',own::text||'/synthetic-receipt','name','পরীক্ষার রসিদ.png','mime','image/png','size',100,'sha256',repeat('9',64));
    perform pg_temp.expect_mcp_error('create_upload',payload||jsonb_build_object('path',other_own::text||'/synthetic-receipt'),'mcp_forbidden');
    perform public.mcp_server('create_upload',payload);
    perform pg_temp.expect_mcp_error('finalize_upload',jsonb_build_object('tokenHash',pat,'id','synthetic-receipt','sha256',repeat('8',64)),'mcp_invalid_receipt');
    result:=public.mcp_server('finalize_upload',jsonb_build_object('tokenHash',pat,'id','synthetic-receipt','sha256',repeat('9',64)));
    if result->>'status'<>'uploaded' then raise exception 'mcp_asset_finalize_failed'; end if;
    perform pg_temp.expect_mcp_error('asset',jsonb_build_object('tokenHash',other_pat,'id','synthetic-receipt'),'mcp_not_found');
    insert into storage.objects(bucket_id,name,owner_id) values('bari-receipts',own::text||'/synthetic-receipt',own::text);
    if not public.mcp_receipt_is_immutable(own::text||'/synthetic-receipt') then raise exception 'mcp_receipt_mutable'; end if;
    protected_doc:=jsonb_set(fifth_doc,'{entries,0,provenance}',jsonb_build_object('version',1,'origin','text','connectionId',conn,'actorName','পরীক্ষার সহকারী','sourceEventId',null,'assetDigests','[]'::jsonb,'recordedAt','2026-11-02T00:00:00Z','reason','পরীক্ষা'));
    update public.ledger_documents set document=protected_doc where owner_id=own;
    rejected:=false;
    begin update public.ledger_documents set document=fifth_doc where owner_id=own;
    exception when others then if sqlerrm='ledger_provenance_would_be_lost' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_old_client_dropped_provenance'; end if;
    changed:=jsonb_set(protected_doc,'{entries,0,provenance,actorName}','"সংশোধনের সহকারী"'::jsonb);
    changed:=jsonb_set(changed,'{entries,0,revisions}',jsonb_build_array(jsonb_build_object('at','2026-11-02T01:00:00Z','before',(protected_doc#>'{entries,0}')-'revisions')));
    update public.ledger_documents set document=changed where owner_id=own;
    rejected:=false;
    begin update public.ledger_documents set document=jsonb_set(changed,'{entries,0,revisions,0,before,provenance}','null'::jsonb) where owner_id=own;
    exception when others then if sqlerrm='ledger_provenance_would_be_lost' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_historical_provenance_lost'; end if;
    if public.ledger_mcp_provenance_is_valid(jsonb_set(changed,'{entries,0,provenance,recordedAt}','"bad-date"'::jsonb)) then raise exception 'mcp_invalid_provenance_allowed'; end if;
    result:=public.mcp_server('rate_limit',jsonb_build_object('key',repeat('6',64),'limit',2,'windowSeconds',60));
    if result->>'allowed'<>'true' then raise exception 'mcp_rate_first_denied'; end if;
    perform public.mcp_server('rate_limit',jsonb_build_object('key',repeat('6',64),'limit',2,'windowSeconds',60));
    result:=public.mcp_server('rate_limit',jsonb_build_object('key',repeat('6',64),'limit',2,'windowSeconds',60));
    if result->>'allowed'<>'false' or (result->>'retryAfter')::int<1 then raise exception 'mcp_rate_limit_missing'; end if;
    if not has_function_privilege('service_role','public.mcp_server(text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.mcp_server(text,jsonb)','EXECUTE') or has_function_privilege('anon','public.mcp_server(text,jsonb)','EXECUTE') then raise exception 'mcp_rpc_privileges_wrong'; end if;
    if has_table_privilege('authenticated','private.mcp_tokens','SELECT') or has_table_privilege('anon','private.mcp_tokens','SELECT') then raise exception 'mcp_tokens_public'; end if;
  end;
  $mcp_checks$;`,
  `set local role service_role;
  do $mcp_service$ begin if public.mcp_server('rate_limit',jsonb_build_object('key',repeat('8',64),'limit',2,'windowSeconds',60))->>'allowed'<>'true' then raise exception 'mcp_service_role_cannot_call_rpc'; end if; end; $mcp_service$; reset role;
  set local role authenticated;
  do $mcp_user_denials$ declare changed integer; rejected boolean:=false; begin
    begin perform public.mcp_server('list_connections',jsonb_build_object('ownerId',${quote(owner)})); exception when insufficient_privilege then rejected:=true; end;
    if not rejected then raise exception 'mcp_user_called_service_rpc'; end if;
    update storage.objects set name=name where bucket_id='bari-receipts' and name=${quote(`${owner}/synthetic-receipt`)};
    get diagnostics changed=row_count;
    if changed<>0 then raise exception 'mcp_owner_overwrote_immutable_receipt'; end if;
    perform set_config('storage.allow_delete_query','true',true);
    delete from storage.objects where bucket_id='bari-receipts' and name=${quote(`${owner}/synthetic-receipt`)};
    get diagnostics changed=row_count;
    if changed<>0 then raise exception 'mcp_owner_deleted_immutable_receipt'; end if;
  end; $mcp_user_denials$; reset role;
  select 'mcp_rollback_passed'; rollback;`,
];
try {
  assert.equal(db(statements.join("\n")), "mcp_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    original,
    "পরীক্ষার শেষে আগের function-গুলো অক্ষত থাকতে হবে।",
  );
  assert.equal(
    db(
      `select not exists(select 1 from auth.users where id in (${quote(owner)}::uuid,${quote(otherOwner)}::uuid)) and not exists(select 1 from public.ledger_documents where owner_id in (${quote(owner)}::uuid,${quote(otherOwner)}::uuid));`,
    ),
    "t",
    "নমুনা পরীক্ষার সব তথ্য ফিরিয়ে নিতে হবে।",
  );
}
console.log(
  "স্থানীয় MCP পরীক্ষা সফল: অনুমতি, মালিক আলাদা থাকা, সীমা, একই কাজের পুনরাবৃত্তি, সংঘর্ষ, অনুমোদন, OAuth/PKCE, refresh rotation, ভাউচার, উৎসের ইতিহাস এবং সম্পূর্ণ rollback।",
);

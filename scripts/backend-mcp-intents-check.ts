import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
    { input: sql, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  ).trim();
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const owner = randomUUID();
const otherOwner = randomUUID();
const hash = (value: string) =>
  createHash("sha256").update(`${owner}:${value}`).digest("hex");
const signatures = [
  "private.mcp_apply(text,jsonb,uuid)",
  "public.mcp_find_duplicates(text,jsonb)",
  "public.mcp_audit(text,integer,integer,text,bigint,boolean)",
];
const fingerprint = () =>
  db(
    `select jsonb_object_agg(name,coalesce(md5(pg_get_functiondef(to_regprocedure(name))),'absent')) from unnest(array[${signatures.map(quote).join(",")}]) name;`,
  );
const original = fingerprint();
assert.equal(
  db("select to_regprocedure('public.mcp_server(text,jsonb)') is not null;"),
  "t",
  "আগের স্থানীয় MCP migration আগে প্রয়োগ করুন।",
);
const installed =
  db(
    "select to_regprocedure('public.mcp_find_duplicates(text,jsonb)') is not null;",
  ) === "t";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611020008_mcp_intents.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const base = LedgerSchema.parse({
  works: [{ id: "synthetic-work", name: "পরীক্ষার কাজ" }],
  people: [{ id: "synthetic-shop", name: "পরীক্ষার দোকান", kind: "shop" }],
});
const documents = [base];
for (let index = 1; index <= 6; index++) {
  documents.push(
    LedgerSchema.parse({
      ...documents[index - 1],
      entries: [
        ...documents[index - 1].entries,
        {
          id: `synthetic-${index}`,
          kind: "expense",
          account: "materials",
          personId: "synthetic-shop",
          lines: [
            { id: `line-${index}`, workId: "synthetic-work", amount: 50000 },
          ],
        },
      ],
    }),
  );
}
const sql = [
  "begin; set local lock_timeout='3s'; set local statement_timeout='30s';",
  ...(installed ? [] : [migration]),
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`mcp-intents-${owner}@example.invalid`)}),(${quote(otherOwner)}::uuid,'authenticated','authenticated',${quote(`mcp-intents-${otherOwner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values(${quote(owner)}::uuid,1,${json(base)});`,
  `create function pg_temp.expect_intent_error(p_action text,p_data jsonb,p_message text) returns void language plpgsql as $expected$
    declare rejected boolean:=false; begin
      begin perform public.mcp_server(p_action,p_data); exception when others then if sqlerrm=p_message then rejected:=true; else raise; end if; end;
      if not rejected then raise exception 'mcp_expected_intent_error_missing: % / %',p_action,p_message; end if;
    end; $expected$;`,
  `do $intent_checks$
  declare
    own uuid:=${quote(owner)}::uuid; other_own uuid:=${quote(otherOwner)}::uuid;
    pat_a text:=${quote(hash("pat-a"))}; pat_b text:=${quote(hash("pat-b"))}; pat_other text:=${quote(hash("pat-other"))};
    event_key text:=${quote(hash("source-event"))}; asset_key text:=${quote(hash("verified-asset"))}; fresh_key text:=${quote(hash("after-failure"))};
    keys jsonb; payload jsonb; result jsonb; operation uuid; conn_a uuid; conn_b uuid; proposal uuid; changed jsonb; actual_count bigint; rejected boolean;
    docs jsonb:=${json(documents)};
    scopes jsonb:='["ledger:read","entries:create","entries:update","entries:void_restore","entities:write","contracts:write","catalog:write","receipts:read","receipts:write"]'::jsonb;
  begin
    keys:=jsonb_build_array(event_key,asset_key);
    result:=public.mcp_server('create_connection',jsonb_build_object('ownerId',own,'name','সহকারী এক','scopes',scopes,'tokenHash',pat_a)); conn_a:=(result#>>'{connection,id}')::uuid;
    result:=public.mcp_server('create_connection',jsonb_build_object('ownerId',own,'name','সহকারী দুই','scopes',scopes,'tokenHash',pat_b)); conn_b:=(result#>>'{connection,id}')::uuid;
    perform public.mcp_server('create_connection',jsonb_build_object('ownerId',other_own,'name','অন্যের সহকারী','scopes',scopes,'tokenHash',pat_other));
    payload:=jsonb_build_object('tokenHash',pat_a,'requestKey','first-event','digest',${quote(hash("command-one"))},'expectedRevision',1,'document',docs->1,'requiredScopes',jsonb_build_array('entries:create'),'amountPaisa',50000,'source',jsonb_build_object('intentKeys',keys),'result',jsonb_build_object('affected_ids',jsonb_build_array('synthetic-1','catalog-target')));
    result:=public.mcp_server('save',payload);
    if result->>'status'<>'saved' or (result->>'revision')::int<>2 then raise exception 'mcp_intent_first_write_failed'; end if;
    result:=public.mcp_find_duplicates(pat_b,keys);
    if jsonb_array_length(result->'operations')<>1 or result#>>'{operations,0,idempotencyKey}'<>'first-event' or jsonb_array_length(result#>'{operations,0,keys}')<>2 then raise exception 'mcp_intent_owner_duplicate_not_found'; end if;
    operation:=(result#>>'{operations,0,operationId}')::uuid;
    if jsonb_array_length(public.mcp_find_duplicates(pat_other,keys)->'operations')<>0 then raise exception 'mcp_intent_cross_owner_leak'; end if;
    result:=public.mcp_server('save',payload);
    if (result->>'revision')::int<>2 then raise exception 'mcp_intent_same_request_replayed'; end if;
    payload:=payload||jsonb_build_object('tokenHash',pat_b,'requestKey','different-request-same-event','digest',${quote(hash("command-two"))},'document',docs->2);
    perform pg_temp.expect_intent_error('save',payload,'mcp_possible_duplicate');
    if (select revision from public.ledger_documents where owner_id=own)<>2 or (select count(*) from private.mcp_operations where owner_id=own)<>1 then raise exception 'mcp_intent_duplicate_changed_ledger'; end if;
    result:=public.mcp_server('save',payload||jsonb_build_object('requestKey','same-amount-new-source','expectedRevision',2,'source','{}'::jsonb));
    if result->>'status'<>'saved' or (result->>'revision')::int<>3 then raise exception 'mcp_same_amount_false_positive'; end if;
    payload:=payload||jsonb_build_object('requestKey','duplicate-override','expectedRevision',3,'document',docs->3);
    perform pg_temp.expect_intent_error('save',payload||jsonb_build_object('source',jsonb_build_object('intentKeys',keys,'duplicateOverride',jsonb_build_object('operationId',gen_random_uuid(),'reason','আলাদা কেনা'))),'mcp_possible_duplicate');
    perform pg_temp.expect_intent_error('save',payload||jsonb_build_object('source',jsonb_build_object('intentKeys',keys,'duplicateOverride',jsonb_build_object('operationId',operation,'reason',' '))),'mcp_possible_duplicate');
    result:=public.mcp_server('save',payload||jsonb_build_object('source',jsonb_build_object('intentKeys',keys,'duplicateOverride',jsonb_build_object('operationId',operation,'reason','একই রসিদে আলাদা কেনার অনুমতি দেওয়া হয়েছে'))));
    if result->>'status'<>'saved' or (result->>'revision')::int<>4 then raise exception 'mcp_valid_duplicate_override_failed'; end if;
    if (select count(*) from private.mcp_intent_keys where owner_id=own)<>2 or not exists(select 1 from private.mcp_operations where owner_id=own and source#>>'{duplicateOverride,reason}'='একই রসিদে আলাদা কেনার অনুমতি দেওয়া হয়েছে') then raise exception 'mcp_intent_override_audit_missing'; end if;
    payload:=payload||jsonb_build_object('requestKey','proposal-duplicate','expectedRevision',4,'document',docs->4);
    result:=public.mcp_server('create_proposal',payload); proposal:=(result->>'proposalId')::uuid;
    perform public.mcp_server('approve_proposal',jsonb_build_object('ownerId',own,'proposalId',proposal,'approve',true));
    perform pg_temp.expect_intent_error('commit_proposal',jsonb_build_object('tokenHash',pat_b,'proposalId',proposal,'requestKey','proposal-duplicate'),'mcp_possible_duplicate');
    result:=public.mcp_server('create_proposal',payload||jsonb_build_object('requestKey','proposal-override','source',jsonb_build_object('intentKeys',keys,'duplicateOverride',jsonb_build_object('operationId',operation,'reason','প্রস্তাবে আলাদা কেনার কারণ নিশ্চিত')))); proposal:=(result->>'proposalId')::uuid;
    perform public.mcp_server('approve_proposal',jsonb_build_object('ownerId',own,'proposalId',proposal,'approve',true));
    result:=public.mcp_server('commit_proposal',jsonb_build_object('tokenHash',pat_b,'proposalId',proposal,'requestKey','proposal-override'));
    if result->>'status'<>'saved' or (result->>'revision')::int<>5 then raise exception 'mcp_proposal_intent_override_failed'; end if;
    changed:=jsonb_set(docs->5,'{entries,4,lines,0,amount}','-1'::jsonb);
    payload:=payload||jsonb_build_object('requestKey','invalid-fresh-key','expectedRevision',5,'document',changed,'source',jsonb_build_object('intentKeys',jsonb_build_array(fresh_key)));
    perform pg_temp.expect_intent_error('save',payload,'mcp_invalid_document');
    if exists(select 1 from private.mcp_intent_keys where owner_id=own and key=fresh_key) then raise exception 'mcp_invalid_write_reserved_intent'; end if;
    result:=public.mcp_server('save',payload||jsonb_build_object('requestKey','valid-fresh-key','document',docs->5));
    if result->>'status'<>'saved' or (result->>'revision')::int<>6 then raise exception 'mcp_intent_not_atomic'; end if;
    result:=public.mcp_audit(pat_a,1,0,null,4,true);
    if (result->>'totalCount')::int<>3 or (result#>>'{operations,0,revision}')::int<>4 or (result->>'nextOffset')::int<>1 then raise exception 'mcp_audit_pin_first_page_wrong'; end if;
    perform public.mcp_server('save',payload||jsonb_build_object('requestKey','newer-than-pinned-page','expectedRevision',6,'document',docs->6,'source','{}'::jsonb));
    result:=public.mcp_audit(pat_a,1,1,null,4,true);
    if (result->>'totalCount')::int<>3 or (result#>>'{operations,0,revision}')::int<>3 then raise exception 'mcp_new_operation_shifted_pinned_audit'; end if;
    result:=public.mcp_audit(pat_a,100,0,'catalog-target',null,true);
    if jsonb_array_length(result->'operations')<>6 then raise exception 'mcp_audit_affected_entity_filter_failed'; end if;
    result:=public.mcp_audit(pat_a,100,0,null,null,false);
    if jsonb_array_length(result->'operations')<>1 then raise exception 'mcp_pinned_connection_filter_failed'; end if;
    result:=public.mcp_audit(pat_other,100,0,null,null,true);
    if jsonb_array_length(result->'operations')<>0 then raise exception 'mcp_pinned_audit_cross_owner_leak'; end if;
    rejected:=false; begin perform public.mcp_audit(pat_a,30,0,null,999,true); exception when others then if sqlerrm='mcp_invalid_request' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_future_audit_pin_accepted'; end if;
    rejected:=false; begin perform public.mcp_find_duplicates(pat_a,jsonb_build_array('not-a-hash')); exception when others then if sqlerrm='mcp_invalid_request' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_invalid_intent_hash_accepted'; end if;
    if has_function_privilege('authenticated','public.mcp_find_duplicates(text,jsonb)','EXECUTE') or has_function_privilege('anon','public.mcp_audit(text,integer,integer,text,bigint,boolean)','EXECUTE') or not has_function_privilege('service_role','public.mcp_find_duplicates(text,jsonb)','EXECUTE') then raise exception 'mcp_intent_privileges_wrong'; end if;
  end; $intent_checks$;
  select 'mcp_intents_rollback_passed'; rollback;`,
].join("\n");
try {
  assert.equal(db(sql), "mcp_intents_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    original,
    "পরীক্ষার শেষে আগের SQL function-গুলো অক্ষত থাকতে হবে।",
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
  "স্থানীয় MCP intent পরীক্ষা সফল: একই উৎসের পুনরাবৃত্তি, অন্য সহকারীর পুনরায় লেখা, অনুমোদিত ব্যতিক্রম, atomic rollback এবং নির্দিষ্ট সংস্করণের সম্পূর্ণ ইতিহাস।",
);

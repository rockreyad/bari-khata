import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { EntrySchema, LedgerSchema } from "../src/domain/model";

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
const signatures = [
  "public.mcp_upload_cleanup(text,jsonb)",
  "public.block_cleaned_mcp_receipts()",
  "private.mcp_apply(text,jsonb,uuid)",
];
const fingerprint = () =>
  db(
    `select jsonb_object_agg(name,coalesce(md5(pg_get_functiondef(to_regprocedure(name))),'absent')) from unnest(array[${signatures.map(quote).join(",")}]) name;`,
  );
const original = fingerprint();
assert.equal(
  db(
    "select to_regprocedure('public.mcp_find_duplicates(text,jsonb)') is not null;",
  ),
  "t",
  "আগের স্থানীয় MCP migration আগে প্রয়োগ করুন।",
);
const installed =
  db(
    "select to_regprocedure('public.mcp_upload_cleanup(text,jsonb)') is not null;",
  ) === "t";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611020009_mcp_upload_cleanup.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const owner = randomUUID(),
  otherOwner = randomUUID();
const receipt = (id: string) => ({
  id,
  name: `${id}.png`,
  mime: "image/png",
  size: 100,
});
const entry = (id: string, receiptId?: string) =>
  EntrySchema.parse({
    id,
    kind: "expense",
    account: "materials",
    personId: "shop",
    lines: [{ id: `${id}-line`, workId: "work", amount: 50000 }],
    receipts: receiptId ? [receipt(receiptId)] : [],
  });
const history = entry("history");
history.revisions.push({
  at: "2026-11-02T00:00:00Z",
  before: entry("history", "keep-history"),
});
const ledger = LedgerSchema.parse({
  works: [{ id: "work", name: "পরীক্ষার কাজ" }],
  people: [{ id: "shop", name: "পরীক্ষার দোকান", kind: "shop" }],
  entries: [entry("current", "keep-current"), history],
});
const proposal = LedgerSchema.parse({
  ...ledger,
  entries: [...ledger.entries, entry("proposal", "keep-proposal")],
});
const claimedReference = LedgerSchema.parse({
  ...ledger,
  entries: [...ledger.entries, entry("too-late", "remove-me")],
});
const sql = [
  "begin; set local lock_timeout='3s'; set local statement_timeout='30s';",
  ...(installed ? [] : [migration]),
  `insert into auth.users(id,aud,role,email) values(${quote(owner)}::uuid,'authenticated','authenticated',${quote(`mcp-cleanup-${owner}@example.invalid`)}),(${quote(otherOwner)}::uuid,'authenticated','authenticated',${quote(`mcp-cleanup-${otherOwner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values(${quote(owner)}::uuid,1,${json(ledger)});`,
  `do $cleanup_checks$
  declare own uuid:=${quote(owner)}::uuid; other_own uuid:=${quote(otherOwner)}::uuid; pat text:=encode(extensions.digest(own::text||':cleanup','sha256'),'hex'); conn uuid; result jsonb; rejected boolean; candidate text; base_doc jsonb:=${json(ledger)}; late_doc jsonb:=${json(claimedReference)};
  begin
    result:=public.mcp_server('create_connection',jsonb_build_object('ownerId',own,'name','পরীক্ষার সহকারী','scopes',jsonb_build_array('ledger:read','receipts:write'),'tokenHash',pat)); conn:=(result#>>'{connection,id}')::uuid;
    foreach candidate in array array['remove-me','keep-current','keep-history','keep-proposal','keep-uploaded','too-recent','still-active'] loop
      insert into private.mcp_assets(owner_id,id,connection_id,path,name,mime,size,status,expires_at) values(own,candidate,conn,own::text||'/'||candidate,candidate||'.png','image/png',100,case when candidate='keep-uploaded' then 'uploaded' else 'pending' end,
        case when candidate='too-recent' then clock_timestamp()-interval '1 hour' when candidate='still-active' then clock_timestamp()+interval '1 hour' else clock_timestamp()-interval '3 hours' end);
    end loop;
    insert into private.mcp_proposals(owner_id,connection_id,request_key,digest,expected_revision,document,result,required_scopes,amount_paisa,expires_at)
      values(own,conn,'protected-proposal',repeat('f',64),1,${json(proposal)},'{}'::jsonb,array['ledger:read'],0,clock_timestamp()+interval '10 minutes');
    result:=public.mcp_upload_cleanup('list',jsonb_build_object('ownerId',own,'limit',100));
    if jsonb_array_length(result->'uploads')<>1 or result#>>'{uploads,0,id}'<>'remove-me' then raise exception 'mcp_cleanup_did_not_protect_live_history_proposal_grace'; end if;
    if result#>>'{uploads,0,stagingPath}'<>own::text||'/.mcp-staging/remove-me' or result#>>'{uploads,0,activePath}'<>own::text||'/remove-me' then raise exception 'mcp_cleanup_noncanonical_path'; end if;
    if not exists(select 1 from private.mcp_assets where owner_id=own and id='remove-me') then raise exception 'mcp_cleanup_deleted_before_storage_ack'; end if;
    result:=public.mcp_upload_cleanup('list',jsonb_build_object('ownerId',own));
    if jsonb_array_length(result->'uploads')<>1 then raise exception 'mcp_cleanup_retry_lost_metadata'; end if;
    rejected:=false; begin update public.ledger_documents set document=late_doc where owner_id=own; exception when others then if sqlerrm='mcp_upload_expired' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_cleanup_race_allowed_late_ledger_reference'; end if;
    rejected:=false; begin insert into private.mcp_proposals(owner_id,connection_id,request_key,digest,expected_revision,document,result,required_scopes,amount_paisa,expires_at)
      values(own,conn,'late-proposal',repeat('e',64),1,late_doc,'{}'::jsonb,array['ledger:read'],0,clock_timestamp()+interval '10 minutes');
      exception when others then if sqlerrm='mcp_upload_expired' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_cleanup_race_allowed_late_proposal'; end if;
    rejected:=false; begin perform public.mcp_upload_cleanup('ack',jsonb_build_object('ownerId',other_own,'id','remove-me')); exception when others then if sqlerrm='mcp_not_found' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_cleanup_wrong_owner_ack'; end if;
    result:=public.mcp_upload_cleanup('ack',jsonb_build_object('ownerId',own,'id','remove-me'));
    if result->>'deleted'<>'true' or exists(select 1 from private.mcp_assets where owner_id=own and id='remove-me') then raise exception 'mcp_cleanup_ack_failed'; end if;
    result:=public.mcp_upload_cleanup('ack',jsonb_build_object('ownerId',own,'id','remove-me'));
    if result->>'alreadyDone'<>'true' then raise exception 'mcp_cleanup_ack_retry_not_idempotent'; end if;
    result:=public.mcp_upload_cleanup('list',jsonb_build_object('ownerId',own));
    if jsonb_array_length(result->'uploads')<>0 then raise exception 'mcp_cleanup_relisted_deleted_upload'; end if;
    rejected:=false; begin perform public.mcp_server('create_upload',jsonb_build_object('tokenHash',pat,'id','remove-me','name','new.png','mime','image/png','size',100,'path',own::text||'/remove-me','sha256','')); exception when others then if sqlerrm='mcp_upload_expired' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'mcp_cleanup_expired_session_revived'; end if;
    if (select document from public.ledger_documents where owner_id=own) is distinct from base_doc or (select revision from public.ledger_documents where owner_id=own)<>1 then raise exception 'mcp_cleanup_changed_financial_data'; end if;
    if (select count(*) from private.mcp_assets where owner_id=own)<>6 then raise exception 'mcp_cleanup_removed_protected_metadata'; end if;
    if has_function_privilege('anon','public.mcp_upload_cleanup(text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.mcp_upload_cleanup(text,jsonb)','EXECUTE') or not has_function_privilege('service_role','public.mcp_upload_cleanup(text,jsonb)','EXECUTE') then raise exception 'mcp_cleanup_privileges_wrong'; end if;
  end; $cleanup_checks$;
  select 'mcp_cleanup_rollback_passed'; rollback;`,
].join("\n");
try {
  assert.equal(db(sql), "mcp_cleanup_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    original,
    "পরীক্ষার শেষে আগের SQL function-গুলো অক্ষত থাকতে হবে।",
  );
  assert.equal(
    db(
      `select not exists(select 1 from auth.users where id in (${quote(owner)}::uuid,${quote(otherOwner)}::uuid));`,
    ),
    "t",
    "নমুনা পরীক্ষার সব তথ্য ফিরিয়ে নিতে হবে।",
  );
}
console.log(
  "স্থানীয় MCP cleanup পরীক্ষা সফল: মেয়াদ ও বাড়তি সময়, ব্যবহৃত/পুরোনো/প্রস্তাবের ভাউচার সুরক্ষা, পুনরায় চেষ্টা, late reference বন্ধ এবং আর্থিক তথ্য অক্ষত থাকা।",
);

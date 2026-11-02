begin;

create table private.mcp_intent_keys (
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  operation_id uuid not null references private.mcp_operations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(owner_id,key)
);
create index mcp_intent_keys_operation on private.mcp_intent_keys(operation_id);
alter table private.mcp_intent_keys enable row level security;
revoke all on private.mcp_intent_keys from public,anon,authenticated;

create function private.mcp_parse_intent_keys(p_value jsonb)
returns text[] language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_keys text[];
begin
  if p_value is null then return '{}'::text[]; end if;
  if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value)>100
    or exists(select 1 from jsonb_array_elements(p_value) k where jsonb_typeof(k)<>'string' or k#>>'{}' !~ '^[0-9a-f]{64}$') then raise exception 'mcp_invalid_request'; end if;
  select coalesce(array_agg(distinct k order by k),'{}'::text[]) into v_keys from jsonb_array_elements_text(p_value) k;
  return v_keys;
end;
$$;

create function private.mcp_duplicate_allowed(p_source jsonb,p_operation uuid)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_overrides jsonb:=coalesce(p_source->'duplicateOverrides','[]'::jsonb); v_override jsonb;
begin
  if p_source ? 'duplicateOverride' then v_overrides:=v_overrides||jsonb_build_array(p_source->'duplicateOverride'); end if;
  if jsonb_typeof(v_overrides) is distinct from 'array' or jsonb_array_length(v_overrides)>100 then return false; end if;
  for v_override in select value from jsonb_array_elements(v_overrides) loop
    if jsonb_typeof(v_override)='object' and v_override->>'operationId'=p_operation::text
      and jsonb_typeof(v_override->'reason')='string' and length(btrim(v_override->>'reason')) between 1 and 2000 then return true; end if;
  end loop;
  return false;
end;
$$;

create function public.mcp_find_duplicates(p_token_hash text,p_keys jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_conn private.mcp_connections; v_keys text[];
begin
  v_conn:=private.mcp_auth(p_token_hash);
  v_keys:=private.mcp_parse_intent_keys(p_keys);
  return jsonb_build_object('operations',coalesce((select jsonb_agg(x.row order by x.at desc,x.id) from (
    select o.id,o.created_at at,jsonb_build_object('operationId',o.id,'idempotencyKey',o.request_key,'connectionId',o.connection_id,'actorName',c.name,'revision',o.revision,'result',o.result,'keys',to_jsonb(array_agg(k.key order by k.key)),'createdAt',o.created_at) row
    from private.mcp_intent_keys k join private.mcp_operations o on o.id=k.operation_id join private.mcp_connections c on c.id=o.connection_id
    where k.owner_id=v_conn.owner_id and k.key=any(v_keys)
    group by o.id,c.name order by o.created_at desc,o.id limit 100
  ) x),'[]'::jsonb));
end;
$$;

create or replace function private.mcp_apply(p_token_hash text,p_data jsonb,p_proposal uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare
  v_conn private.mcp_connections; v_document public.ledger_documents; v_previous private.mcp_operations; v_proposal private.mcp_proposals;
  v_request text; v_digest text; v_candidate jsonb; v_result jsonb; v_source jsonb; v_scopes text[]; v_changes jsonb;
  v_expected bigint; v_revision bigint; v_amount numeric; v_daily_amount numeric; v_daily_count bigint; v_now timestamptz:=clock_timestamp();
  v_receipt jsonb; v_asset private.mcp_assets; v_before jsonb; v_id text;
  v_intents text[]; v_conflict uuid; v_operation uuid;
begin
  v_conn:=private.mcp_auth(p_token_hash,true,p_data->>'resource');
  if p_proposal is not null then
    select * into v_proposal from private.mcp_proposals where id=p_proposal and owner_id=v_conn.owner_id and connection_id=v_conn.id for update;
    if not found then raise exception 'mcp_not_found'; end if;
    if p_data->>'requestKey' is distinct from v_proposal.request_key then raise exception 'mcp_operation_mismatch'; end if;
    p_data:=jsonb_build_object('requestKey',v_proposal.request_key,'digest',v_proposal.digest,'expectedRevision',v_proposal.expected_revision,'document',v_proposal.document,'result',v_proposal.result,'requiredScopes',to_jsonb(v_proposal.required_scopes),'amountPaisa',v_proposal.amount_paisa,'source',v_proposal.source);
  end if;
  v_request:=p_data->>'requestKey'; v_digest:=p_data->>'digest';
  if coalesce(length(v_request),0) not between 1 and 200 or v_digest is null or v_digest !~ '^[0-9a-f]{64}$' then raise exception 'mcp_invalid_request'; end if;
  select * into v_previous from private.mcp_operations where connection_id=v_conn.id and request_key=v_request;
  if found then
    if v_previous.digest<>v_digest then raise exception 'mcp_operation_mismatch'; end if;
    return jsonb_build_object('status','saved','revision',v_previous.revision,'updatedAt',v_previous.created_at,'result',v_previous.result);
  end if;
  if p_proposal is not null then
    if v_proposal.status='rejected' then raise exception 'mcp_proposal_rejected'; end if;
    if v_proposal.expires_at<=v_now then raise exception 'mcp_proposal_expired'; end if;
    if v_proposal.status<>'approved' then raise exception 'mcp_proposal_pending'; end if;
  elsif coalesce((v_conn.policy->>'confirmationRequired')::boolean,false) then raise exception 'mcp_confirmation_required'; end if;
  v_candidate:=p_data->'document'; v_result:=coalesce(p_data->'result','{}'::jsonb); v_source:=coalesce(p_data->'source','{}'::jsonb);
  if jsonb_typeof(v_candidate) is distinct from 'object' or jsonb_typeof(v_source) is distinct from 'object' or octet_length(v_candidate::text)>10485760 or octet_length(v_result::text)>262144 or octet_length(v_source::text)>786432 then raise exception 'mcp_invalid_document'; end if;
  if jsonb_typeof(p_data->'expectedRevision')<>'number' or (p_data->>'expectedRevision')::numeric<0 or trunc((p_data->>'expectedRevision')::numeric)<>(p_data->>'expectedRevision')::numeric then raise exception 'mcp_invalid_request'; end if;
  v_expected:=(p_data->>'expectedRevision')::bigint;
  v_intents:=private.mcp_parse_intent_keys(v_source->'intentKeys');
  perform pg_advisory_xact_lock(hashtextextended(v_conn.owner_id::text,0));
  for v_conflict in select distinct operation_id from private.mcp_intent_keys where owner_id=v_conn.owner_id and key=any(v_intents) loop
    if not private.mcp_duplicate_allowed(v_source,v_conflict) then raise exception 'mcp_possible_duplicate'; end if;
  end loop;
  select * into v_document from public.ledger_documents where owner_id=v_conn.owner_id;
  v_revision:=coalesce(v_document.revision,0);
  if v_revision<>v_expected then return jsonb_build_object('status','conflict','revision',v_revision,'updatedAt',v_document.updated_at); end if;
  v_changes:=private.mcp_document_changes(v_document.document,v_candidate);
  v_scopes:=private.mcp_scopes(p_data->'requiredScopes');
  v_scopes:=array(select distinct s from unnest(v_scopes||private.mcp_scopes(v_changes->'requiredScopes')) s order by s);
  if not(v_conn.scopes @> v_scopes) then raise exception 'mcp_scope_required'; end if;
  v_amount:=greatest(coalesce((p_data->>'amountPaisa')::numeric,0),(v_changes->>'amountPaisa')::numeric);
  if v_amount<0 or v_amount>9007199254740991 or trunc(v_amount)<>v_amount then raise exception 'mcp_invalid_request'; end if;
  if p_proposal is null and v_conn.policy ? 'maxAmountPaisa' and v_amount>(v_conn.policy->>'maxAmountPaisa')::numeric then raise exception 'mcp_limit_exceeded'; end if;
  select coalesce(sum(amount_paisa),0),count(*) into v_daily_amount,v_daily_count from private.mcp_operations
    where connection_id=v_conn.id and created_at>=date_trunc('day',v_now at time zone 'Asia/Dhaka') at time zone 'Asia/Dhaka';
  if (v_conn.policy ? 'maxDailyAmountPaisa' and v_daily_amount+v_amount>(v_conn.policy->>'maxDailyAmountPaisa')::numeric)
    or (v_conn.policy ? 'maxDailyOperations' and v_daily_count>=(v_conn.policy->>'maxDailyOperations')::numeric) then raise exception 'mcp_limit_exceeded'; end if;
  v_before:=coalesce(v_document.document->'entries','[]'::jsonb);
  for v_receipt in select r from jsonb_array_elements(v_candidate->'entries') e cross join lateral jsonb_array_elements(coalesce(e->'receipts','[]'::jsonb)) r loop
    if exists(select 1 from jsonb_array_elements(v_before) old_e cross join lateral jsonb_array_elements(coalesce(old_e->'receipts','[]'::jsonb)) old_r where old_r=v_receipt) then continue; end if;
    select * into v_asset from private.mcp_assets where owner_id=v_conn.owner_id and id=v_receipt->>'id' and status='uploaded';
    if not found or v_asset.mime is distinct from v_receipt->>'mime' or v_asset.size is distinct from (v_receipt->>'size')::bigint then raise exception 'mcp_receipt_not_ready'; end if;
  end loop;
  v_revision:=v_revision+1;
  insert into public.ledger_documents(owner_id,revision,document,updated_at) values(v_conn.owner_id,v_revision,v_candidate,v_now)
    on conflict(owner_id) do update set revision=excluded.revision,document=excluded.document,updated_at=excluded.updated_at;
  insert into private.mcp_operations(owner_id,connection_id,request_key,digest,revision,amount_paisa,required_scopes,source,result,entry_ids,created_at)
    values(v_conn.owner_id,v_conn.id,v_request,v_digest,v_revision,v_amount::bigint,v_scopes,v_source,v_result,array(select jsonb_array_elements_text(v_changes->'entryIds')),v_now) returning id into v_operation;
  insert into private.mcp_intent_keys(owner_id,key,operation_id)
    select v_conn.owner_id,k,v_operation from unnest(v_intents) k on conflict(owner_id,key) do nothing;
  if p_proposal is not null then update private.mcp_proposals set status='committed',committed_at=v_now where id=p_proposal; end if;
  return jsonb_build_object('status','saved','revision',v_revision,'updatedAt',v_now,'result',v_result);
end;
$$;

create function public.mcp_audit(p_token_hash text,p_limit integer default 30,p_offset integer default 0,p_entity_id text default null,p_revision bigint default null,p_include_all boolean default true)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_conn private.mcp_connections; v_current bigint; v_revision bigint; v_limit integer; v_total bigint;
begin
  v_conn:=private.mcp_auth(p_token_hash);
  select revision into v_current from public.ledger_documents where owner_id=v_conn.owner_id;
  v_revision:=coalesce(p_revision,v_current,0); v_limit:=least(100,greatest(1,coalesce(p_limit,30)));
  if p_offset is null or p_offset<0 or p_offset>1000000 or v_revision<0 or v_revision>coalesce(v_current,0) or (p_entity_id is not null and length(p_entity_id) not between 1 and 160) then raise exception 'mcp_invalid_request'; end if;
  select count(*) into v_total from private.mcp_operations o where o.owner_id=v_conn.owner_id and o.revision<=v_revision
    and (coalesce(p_include_all,true) or o.connection_id=v_conn.id)
    and (p_entity_id is null or p_entity_id=any(o.entry_ids) or (o.result->'affected_ids') ? p_entity_id);
  return jsonb_build_object('revision',v_revision,'totalCount',v_total,'nextOffset',case when p_offset+v_limit<v_total then p_offset+v_limit else null end,
    'operations',coalesce((select jsonb_agg(x.row order by x.at desc,x.id desc) from (
      select o.id,o.created_at at,jsonb_build_object('id',o.id,'connectionId',o.connection_id,'actorName',c.name,'requestKey',o.request_key,'revision',o.revision,'amountPaisa',o.amount_paisa,'requiredScopes',to_jsonb(o.required_scopes),'source',o.source,'result',o.result,'entryIds',to_jsonb(o.entry_ids),'createdAt',o.created_at) row
      from private.mcp_operations o join private.mcp_connections c on c.id=o.connection_id where o.owner_id=v_conn.owner_id and o.revision<=v_revision
        and (coalesce(p_include_all,true) or o.connection_id=v_conn.id)
        and (p_entity_id is null or p_entity_id=any(o.entry_ids) or (o.result->'affected_ids') ? p_entity_id)
      order by o.created_at desc,o.id desc limit v_limit offset p_offset
    ) x),'[]'::jsonb));
end;
$$;

revoke all on function private.mcp_parse_intent_keys(jsonb),private.mcp_duplicate_allowed(jsonb,uuid) from public,anon,authenticated;
revoke all on function public.mcp_find_duplicates(text,jsonb),public.mcp_audit(text,integer,integer,text,bigint,boolean) from public,anon,authenticated;
grant execute on function public.mcp_find_duplicates(text,jsonb),public.mcp_audit(text,integer,integer,text,bigint,boolean) to service_role;
notify pgrst,'reload schema';

commit;

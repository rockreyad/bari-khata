begin;

create table private.mcp_clients (
  client_id text primary key check (length(client_id) between 1 and 160),
  client_name text not null check (length(client_name) between 1 and 200),
  redirect_uris jsonb not null check (jsonb_typeof(redirect_uris)='array'),
  auth_method text not null check (auth_method in ('none','client_secret_basic','client_secret_post')),
  secret_hash text check (secret_hash is null or secret_hash ~ '^[0-9a-f]{64}$'),
  scopes text[] not null,
  created_at timestamptz not null default now()
);
create table private.mcp_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id text references private.mcp_clients(client_id),
  name text not null check (length(name) between 1 and 200),
  scopes text[] not null,
  policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);
create index mcp_connections_owner on private.mcp_connections(owner_id,created_at desc);
create table private.mcp_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  connection_id uuid not null references private.mcp_connections(id) on delete cascade,
  kind text not null check (kind in ('personal','access','refresh')),
  client_id text references private.mcp_clients(client_id),
  family_id uuid not null default gen_random_uuid(),
  resource text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  used_at timestamptz
);
create index mcp_tokens_connection on private.mcp_tokens(connection_id);
create index mcp_tokens_family on private.mcp_tokens(family_id);
create table private.mcp_authorizations (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references private.mcp_clients(client_id),
  redirect_uri text not null,
  scopes text[] not null,
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource text not null check (length(resource) between 1 and 2048),
  state text not null default '' check (length(state)<=2048),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  approved_at timestamptz
);
create table private.mcp_codes (
  code_hash text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  connection_id uuid not null references private.mcp_connections(id) on delete cascade,
  client_id text not null references private.mcp_clients(client_id),
  redirect_uri text not null,
  code_challenge text not null,
  resource text not null,
  expires_at timestamptz not null default (now()+interval '5 minutes'),
  used_at timestamptz
);
create table private.mcp_operations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references private.mcp_connections(id) on delete cascade,
  request_key text not null check (length(request_key) between 1 and 200),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  revision bigint not null check (revision>0),
  amount_paisa bigint not null check (amount_paisa between 0 and 9007199254740991),
  required_scopes text[] not null,
  source jsonb not null default '{}'::jsonb,
  result jsonb not null,
  entry_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(connection_id,request_key)
);
create index mcp_operations_owner on private.mcp_operations(owner_id,created_at desc,id);
create index mcp_operations_connection_day on private.mcp_operations(connection_id,created_at);
create table private.mcp_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references private.mcp_connections(id) on delete cascade,
  request_key text not null,
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  expected_revision bigint not null check (expected_revision>=0),
  document jsonb not null check (octet_length(document::text)<=10485760),
  result jsonb not null,
  required_scopes text[] not null,
  amount_paisa bigint not null check (amount_paisa between 0 and 9007199254740991),
  source jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','committed')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  committed_at timestamptz,
  unique(connection_id,request_key)
);
create index mcp_proposals_owner on private.mcp_proposals(owner_id,created_at desc);
create table private.mcp_assets (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  connection_id uuid not null references private.mcp_connections(id) on delete cascade,
  path text not null unique,
  name text not null check (length(name) between 1 and 300),
  mime text not null check (mime in ('image/jpeg','image/png','image/webp','application/pdf')),
  size bigint not null check (size between 1 and 10485760),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending','uploaded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  uploaded_at timestamptz,
  primary key(owner_id,id)
);
create index mcp_assets_connection on private.mcp_assets(connection_id,created_at desc);
create table private.mcp_rate_limits (
  bucket_key text primary key check (bucket_key ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts>0),
  expires_at timestamptz not null
);
create index mcp_rate_limits_expiry on private.mcp_rate_limits(expires_at);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('bari-mcp-staging','bari-mcp-staging',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','application/octet-stream'])
  on conflict(id) do nothing;

do $lock_tables$
declare v_name text;
begin
  foreach v_name in array array['mcp_clients','mcp_connections','mcp_tokens','mcp_authorizations','mcp_codes','mcp_operations','mcp_proposals','mcp_assets','mcp_rate_limits'] loop
    execute format('alter table private.%I enable row level security',v_name);
    execute format('revoke all on private.%I from public,anon,authenticated',v_name);
  end loop;
end;
$lock_tables$;

create function private.mcp_scopes(p_value jsonb)
returns text[] language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_scopes text[];
begin
  if p_value is null or p_value='null'::jsonb then return array['ledger:read']; end if;
  if jsonb_typeof(p_value)='string' then
    select coalesce(array_agg(distinct s order by s),'{}') into v_scopes from regexp_split_to_table(btrim(p_value#>>'{}'),'\s+') s where s<>'';
  elsif jsonb_typeof(p_value)='array' then
    if exists(select 1 from jsonb_array_elements(p_value) x where jsonb_typeof(x)<>'string') then raise exception 'mcp_invalid_request'; end if;
    select coalesce(array_agg(distinct s order by s),'{}') into v_scopes from jsonb_array_elements_text(p_value) s;
  else raise exception 'mcp_invalid_request'; end if;
  if cardinality(v_scopes)>9 or not(v_scopes <@ array['ledger:read','entries:create','entries:update','entries:void_restore','entities:write','contracts:write','catalog:write','receipts:read','receipts:write']) then raise exception 'mcp_invalid_scope'; end if;
  return v_scopes;
end;
$$;

create function private.mcp_policy(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_policy jsonb:=coalesce(p_value,'{}'::jsonb); v_key text; v_amount numeric;
begin
  if jsonb_typeof(v_policy)<>'object' or octet_length(v_policy::text)>4096 then raise exception 'mcp_invalid_request'; end if;
  for v_key in select jsonb_object_keys(v_policy) loop
    if v_key not in ('maxAmountPaisa','maxDailyAmountPaisa','maxDailyOperations','confirmationRequired','requireApproval') then raise exception 'mcp_invalid_request'; end if;
    if v_key in ('confirmationRequired','requireApproval') then
      if jsonb_typeof(v_policy->v_key)<>'boolean' then raise exception 'mcp_invalid_request'; end if;
    else
      if jsonb_typeof(v_policy->v_key)<>'number' then raise exception 'mcp_invalid_request'; end if;
      v_amount:=(v_policy->>v_key)::numeric;
      if v_amount<0 or v_amount>9007199254740991 or trunc(v_amount)<>v_amount then raise exception 'mcp_invalid_request'; end if;
    end if;
  end loop;
  if v_policy ? 'requireApproval' then
    v_policy:=(v_policy-'requireApproval')||jsonb_build_object('confirmationRequired',coalesce((v_policy->>'confirmationRequired')::boolean,false) or (v_policy->>'requireApproval')::boolean);
  end if;
  return v_policy;
end;
$$;

create function private.mcp_connection_json(p_connection private.mcp_connections)
returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('id',p_connection.id,'ownerId',p_connection.owner_id,'clientId',p_connection.client_id,'name',p_connection.name,'scopes',to_jsonb(p_connection.scopes),'policy',p_connection.policy,'createdAt',p_connection.created_at,'expiresAt',p_connection.expires_at,'revokedAt',p_connection.revoked_at);
$$;

create function private.mcp_auth(p_token_hash text,p_lock boolean default false,p_resource text default null)
returns private.mcp_connections language plpgsql set search_path=pg_catalog,pg_temp as $$
declare v_connection private.mcp_connections;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'mcp_unauthorized'; end if;
  if p_lock then
    select c.* into v_connection from private.mcp_connections c join private.mcp_tokens t on t.connection_id=c.id
      where t.token_hash=p_token_hash and t.kind in ('personal','access') and t.revoked_at is null and t.expires_at>clock_timestamp() for update of c;
  else
    select c.* into v_connection from private.mcp_connections c join private.mcp_tokens t on t.connection_id=c.id
      where t.token_hash=p_token_hash and t.kind in ('personal','access') and t.revoked_at is null and t.expires_at>clock_timestamp();
  end if;
  if not found then raise exception 'mcp_unauthorized'; end if;
  if p_resource is not null and exists(select 1 from private.mcp_tokens where token_hash=p_token_hash and kind<>'personal' and resource is distinct from p_resource) then raise exception 'mcp_unauthorized'; end if;
  if v_connection.revoked_at is not null or (v_connection.expires_at is not null and v_connection.expires_at<=clock_timestamp()) then raise exception 'mcp_connection_revoked'; end if;
  if not('ledger:read'=any(v_connection.scopes)) then raise exception 'mcp_scope_required'; end if;
  return v_connection;
end;
$$;

create function private.mcp_comparable(p_value jsonb,p_kind text default '')
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_result jsonb; v_key text; v_value jsonb;
begin
  if jsonb_typeof(p_value)='array' then
    select coalesce(jsonb_agg(private.mcp_comparable(value,p_kind) order by ordinality),'[]'::jsonb) into v_result from jsonb_array_elements(p_value) with ordinality;
    return v_result;
  elsif jsonb_typeof(p_value)<>'object' then return p_value; end if;
  v_result:='{}'::jsonb;
  for v_key,v_value in select key,value from jsonb_each(p_value) loop
    if v_value in ('null'::jsonb,'""'::jsonb,'[]'::jsonb) then continue; end if;
    if (v_key='voided' and v_value='false'::jsonb)
      or (v_key='balanceImpact' and v_value='"normal"'::jsonb)
      or (v_key='reviewStatus' and v_value='"confirmed"'::jsonb)
      or (v_key='costType' and v_value='"material"'::jsonb)
      or (v_key='account' and v_value='"materials"'::jsonb)
      or (v_key='method' and v_value='"cash"'::jsonb)
      or (p_kind='works' and ((v_key='color' and v_value='"sage"'::jsonb) or (v_key='icon' and v_value='"home"'::jsonb) or (v_key='status' and v_value='"ongoing"'::jsonb)))
      or (p_kind='contracts' and ((v_key='scope' and v_value='"work"'::jsonb) or (v_key='basis' and v_value='"fixed"'::jsonb) or (v_key='quantity' and v_value='"1"'::jsonb) or (v_key='rate' and v_value='0'::jsonb))) then continue; end if;
    if v_key in ('phone','quantity') and jsonb_typeof(v_value)='string' then v_value:=to_jsonb(translate(v_value#>>'{}','০১২৩৪৫৬৭৮৯','0123456789')); end if;
    v_result:=v_result||jsonb_build_object(v_key,private.mcp_comparable(v_value,p_kind));
  end loop;
  return v_result;
end;
$$;

create function private.mcp_document_changes(p_before jsonb,p_after jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_scopes text[]:=array['ledger:read']; v_ids text[]:='{}'; v_entry jsonb; v_old jsonb; v_key text; v_amount numeric:=0; v_new_amount numeric; v_old_amount numeric;
begin
  if p_before is not null and p_before->'project' is distinct from p_after->'project' then raise exception 'mcp_forbidden'; end if;
  foreach v_key in array array['works','people','contracts','items','materialGroups','paymentPurposes'] loop
    if private.mcp_comparable(coalesce(p_before->v_key,'[]'::jsonb),v_key) is distinct from private.mcp_comparable(coalesce(p_after->v_key,'[]'::jsonb),v_key) then
      v_scopes:=array_append(v_scopes,case when v_key in ('works','people') then 'entities:write' when v_key='contracts' then 'contracts:write' else 'catalog:write' end);
    end if;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_after->'contracts','[]'::jsonb)) loop
    select value into v_old from jsonb_array_elements(coalesce(p_before->'contracts','[]'::jsonb)) old where old->>'id'=v_entry->>'id';
    if v_old is null or v_old->'total' is distinct from v_entry->'total' then v_amount:=greatest(v_amount,(v_entry->>'total')::numeric); end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(coalesce(p_before->'entries','[]'::jsonb)) old where not exists(select 1 from jsonb_array_elements(p_after->'entries') n where n->>'id'=old->>'id')) then raise exception 'mcp_forbidden'; end if;
  for v_entry in select value from jsonb_array_elements(p_after->'entries') loop
    select value into v_old from jsonb_array_elements(coalesce(p_before->'entries','[]'::jsonb)) old where old->>'id'=v_entry->>'id';
    if private.mcp_comparable(v_old,'entries') is not distinct from private.mcp_comparable(v_entry,'entries') then continue; end if;
    v_ids:=array_append(v_ids,v_entry->>'id');
    if v_old is null then v_scopes:=array_append(v_scopes,'entries:create');
    elsif private.mcp_comparable(v_old-array['voided','updatedAt','revisions','provenance'],'entries')=private.mcp_comparable(v_entry-array['voided','updatedAt','revisions','provenance'],'entries') and coalesce(v_old->'voided','false'::jsonb) is distinct from coalesce(v_entry->'voided','false'::jsonb) then
      v_scopes:=array_append(v_scopes,'entries:void_restore');
    else v_scopes:=array_append(v_scopes,'entries:update'); end if;
    select coalesce(sum((x->>'amount')::numeric),0) into v_new_amount from jsonb_array_elements(coalesce(v_entry->'lines','[]'::jsonb)||coalesce(v_entry->'paymentParts','[]'::jsonb)) x;
    select coalesce(sum((x->>'amount')::numeric),0) into v_old_amount from jsonb_array_elements(coalesce(v_old->'lines','[]'::jsonb)||coalesce(v_old->'paymentParts','[]'::jsonb)) x;
    if v_old is null or private.mcp_comparable(v_old-array['receipts','updatedAt','revisions','provenance'],'entries') is distinct from private.mcp_comparable(v_entry-array['receipts','updatedAt','revisions','provenance'],'entries') then
      v_amount:=greatest(v_amount,v_new_amount,v_old_amount);
    end if;
    if coalesce(v_entry->'receipts','[]'::jsonb) is distinct from coalesce(v_old->'receipts','[]'::jsonb) then
      v_scopes:=array_append(v_scopes,'receipts:write');
    end if;
  end loop;
  select array_agg(distinct s order by s) into v_scopes from unnest(v_scopes) s;
  if v_amount>9007199254740991 or v_amount<0 or trunc(v_amount)<>v_amount then raise exception 'mcp_invalid_document'; end if;
  return jsonb_build_object('requiredScopes',to_jsonb(v_scopes),'amountPaisa',v_amount,'entryIds',to_jsonb(v_ids));
end;
$$;

create function private.mcp_asset_json(p_asset private.mcp_assets)
returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('id',p_asset.id,'ownerId',p_asset.owner_id,'connectionId',p_asset.connection_id,'path',p_asset.path,'name',p_asset.name,'mime',p_asset.mime,'size',p_asset.size,'sha256',p_asset.sha256,'status',p_asset.status,'createdAt',p_asset.created_at,'expiresAt',p_asset.expires_at,'uploadedAt',p_asset.uploaded_at);
$$;

create function private.mcp_apply(p_token_hash text,p_data jsonb,p_proposal uuid default null)
returns jsonb language plpgsql set search_path=pg_catalog,pg_temp as $$
declare
  v_conn private.mcp_connections; v_document public.ledger_documents; v_previous private.mcp_operations; v_proposal private.mcp_proposals;
  v_request text; v_digest text; v_candidate jsonb; v_result jsonb; v_source jsonb; v_scopes text[]; v_changes jsonb;
  v_expected bigint; v_revision bigint; v_amount numeric; v_daily_amount numeric; v_daily_count bigint; v_now timestamptz:=clock_timestamp();
  v_receipt jsonb; v_asset private.mcp_assets; v_before jsonb; v_id text;
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
  perform pg_advisory_xact_lock(hashtextextended(v_conn.owner_id::text,0));
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
    values(v_conn.owner_id,v_conn.id,v_request,v_digest,v_revision,v_amount::bigint,v_scopes,v_source,v_result,array(select jsonb_array_elements_text(v_changes->'entryIds')),v_now);
  if p_proposal is not null then update private.mcp_proposals set status='committed',committed_at=v_now where id=p_proposal; end if;
  return jsonb_build_object('status','saved','revision',v_revision,'updatedAt',v_now,'result',v_result);
end;
$$;

create function public.mcp_server(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  v_conn private.mcp_connections; v_client private.mcp_clients; v_auth private.mcp_authorizations; v_code private.mcp_codes;
  v_token private.mcp_tokens; v_proposal private.mcp_proposals; v_asset private.mcp_assets; v_doc public.ledger_documents;
  v_scopes text[]; v_policy jsonb; v_owner uuid; v_id uuid; v_hash text; v_access text; v_refresh text; v_family uuid;
  v_result jsonb; v_changes jsonb; v_now timestamptz:=clock_timestamp(); v_expiry timestamptz; v_uri text; v_method text;
  v_limit integer; v_offset integer; v_rate private.mcp_rate_limits; v_window integer;
begin
  if p_action is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>11534336 then raise exception 'mcp_invalid_request'; end if;
  if p_action='rate_limit' then
    v_hash:=p_data->>'key'; v_limit:=(p_data->>'limit')::integer; v_window:=(p_data->>'windowSeconds')::integer;
    if coalesce(v_hash,'') !~ '^[0-9a-f]{64}$' or v_limit is null or v_limit not between 1 and 100000 or v_window is null or v_window not between 1 and 86400 then raise exception 'mcp_invalid_request'; end if;
    insert into private.mcp_rate_limits as stored(bucket_key,window_started_at,attempts,expires_at) values(v_hash,v_now,1,v_now+make_interval(secs=>v_window))
      on conflict(bucket_key) do update set window_started_at=case when stored.expires_at<=v_now then v_now else stored.window_started_at end,
        attempts=case when stored.expires_at<=v_now then 1 else least(stored.attempts+1,100001) end,
        expires_at=case when stored.expires_at<=v_now then v_now+make_interval(secs=>v_window) else stored.expires_at end returning * into v_rate;
    delete from private.mcp_rate_limits where bucket_key in(select bucket_key from private.mcp_rate_limits where expires_at<v_now-interval '1 day' order by expires_at limit 100 for update skip locked);
    return jsonb_build_object('allowed',v_rate.attempts<=v_limit,'retryAfter',case when v_rate.attempts<=v_limit then 0 else greatest(1,ceil(extract(epoch from v_rate.expires_at-v_now))::integer) end);
  elsif p_action='create_connection' then
    v_owner:=(p_data->>'ownerId')::uuid; v_scopes:=private.mcp_scopes(p_data->'scopes'); v_policy:=private.mcp_policy(p_data->'policy');
    if not('ledger:read'=any(v_scopes)) then raise exception 'mcp_invalid_scope'; end if;
    v_expiry:=coalesce((p_data->>'expiresAt')::timestamptz,v_now+interval '90 days');
    if v_expiry<=v_now or v_expiry>v_now+interval '366 days' then raise exception 'mcp_invalid_request'; end if;
    insert into private.mcp_connections(owner_id,name,scopes,policy,expires_at) values(v_owner,btrim(p_data->>'name'),v_scopes,v_policy,v_expiry) returning * into v_conn;
    insert into private.mcp_tokens(token_hash,connection_id,kind,expires_at) values(p_data->>'tokenHash',v_conn.id,'personal',v_expiry);
    return jsonb_build_object('connection',private.mcp_connection_json(v_conn),'expiresAt',v_expiry);
  elsif p_action='list_connections' then
    v_owner:=(p_data->>'ownerId')::uuid;
    return jsonb_build_object('connections',coalesce((select jsonb_agg(private.mcp_connection_json(c) order by c.created_at desc,c.id) from private.mcp_connections c where c.owner_id=v_owner),'[]'::jsonb));
  elsif p_action='revoke_connection' then
    v_owner:=(p_data->>'ownerId')::uuid;
    update private.mcp_connections set revoked_at=coalesce(revoked_at,v_now) where id=(p_data->>'connectionId')::uuid and owner_id=v_owner returning * into v_conn;
    if not found then raise exception 'mcp_not_found'; end if;
    update private.mcp_tokens set revoked_at=coalesce(revoked_at,v_now) where connection_id=v_conn.id;
    return jsonb_build_object('revoked',true);
  elsif p_action='authenticate' then
    v_conn:=private.mcp_auth(p_data->>'tokenHash',false,p_data->>'resource');
    select * into v_doc from public.ledger_documents where owner_id=v_conn.owner_id;
    return jsonb_build_object('connection',private.mcp_connection_json(v_conn),'snapshot',jsonb_build_object('revision',coalesce(v_doc.revision,0),'document',v_doc.document,'updatedAt',v_doc.updated_at));
  elsif p_action='save' then return private.mcp_apply(p_data->>'tokenHash',p_data);
  elsif p_action='operation' then
    v_conn:=private.mcp_auth(p_data->>'tokenHash',false,p_data->>'resource');
    select jsonb_build_object('status','saved','revision',o.revision,'updatedAt',o.created_at,'result',o.result,'digest',o.digest) into v_result from private.mcp_operations o where o.connection_id=v_conn.id and o.request_key=p_data->>'requestKey';
    if found then return v_result; end if;
    return (select jsonb_build_object('status',case when p.expires_at<=v_now then 'expired' else p.status end,'proposalId',p.id,'expiresAt',p.expires_at,'result',p.result,'digest',p.digest) from private.mcp_proposals p where p.connection_id=v_conn.id and p.request_key=p_data->>'requestKey');
  elsif p_action='list_audit' then
    if p_data ? 'tokenHash' then v_conn:=private.mcp_auth(p_data->>'tokenHash',false,p_data->>'resource'); v_owner:=v_conn.owner_id;
    else v_owner:=(p_data->>'ownerId')::uuid; end if;
    v_limit:=least(100,greatest(1,coalesce((p_data->>'limit')::integer,30))); v_offset:=greatest(0,coalesce((p_data->>'offset')::integer,0));
    if v_offset>100000 then raise exception 'mcp_invalid_request'; end if;
    return jsonb_build_object('operations',coalesce((select jsonb_agg(x.row order by x.at desc,x.id desc) from
      (select o.id,o.created_at at,jsonb_build_object('id',o.id,'connectionId',o.connection_id,'actorName',c.name,'requestKey',o.request_key,'revision',o.revision,'amountPaisa',o.amount_paisa,'requiredScopes',to_jsonb(o.required_scopes),'source',o.source,'result',o.result,'entryIds',to_jsonb(o.entry_ids),'createdAt',o.created_at) row
        from private.mcp_operations o join private.mcp_connections c on c.id=o.connection_id where o.owner_id=v_owner
          and (not(p_data ? 'tokenHash') or coalesce((p_data->>'includeAll')::boolean,false) or not coalesce((p_data->>'connectionOnly')::boolean,true) or o.connection_id=v_conn.id)
          and (coalesce(p_data->>'entryId',p_data->>'entityId',p_data->>'targetId') is null or coalesce(p_data->>'entryId',p_data->>'entityId',p_data->>'targetId')=any(o.entry_ids) or (o.result->'affected_ids') ? coalesce(p_data->>'entryId',p_data->>'entityId',p_data->>'targetId'))
        order by o.created_at desc,o.id desc limit v_limit offset v_offset) x),'[]'::jsonb));
  elsif p_action='create_proposal' then
    v_conn:=private.mcp_auth(p_data->>'tokenHash',true,p_data->>'resource');
    if coalesce(length(p_data->>'requestKey'),0) not between 1 and 200 or coalesce(p_data->>'digest','') !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_data->'document') is distinct from 'object' then raise exception 'mcp_invalid_request'; end if;
    select * into v_proposal from private.mcp_proposals where connection_id=v_conn.id and request_key=p_data->>'requestKey';
    if found then
      if v_proposal.digest<>p_data->>'digest' then raise exception 'mcp_operation_mismatch'; end if;
      return jsonb_build_object('status',v_proposal.status,'proposalId',v_proposal.id,'expiresAt',v_proposal.expires_at,'result',v_proposal.result);
    end if;
    select * into v_doc from public.ledger_documents where owner_id=v_conn.owner_id;
    if coalesce(v_doc.revision,0) is distinct from (p_data->>'expectedRevision')::bigint then return jsonb_build_object('status','conflict','revision',coalesce(v_doc.revision,0),'updatedAt',v_doc.updated_at); end if;
    v_changes:=private.mcp_document_changes(v_doc.document,p_data->'document');
    v_scopes:=array(select distinct s from unnest(private.mcp_scopes(p_data->'requiredScopes')||private.mcp_scopes(v_changes->'requiredScopes')) s order by s);
    if not(v_conn.scopes @> v_scopes) then raise exception 'mcp_scope_required'; end if;
    v_expiry:=coalesce((p_data->>'expiresAt')::timestamptz,v_now+interval '30 minutes');
    if v_expiry<=v_now or v_expiry>v_now+interval '24 hours' then raise exception 'mcp_invalid_request'; end if;
    insert into private.mcp_proposals(owner_id,connection_id,request_key,digest,expected_revision,document,result,required_scopes,amount_paisa,source,expires_at)
      values(v_conn.owner_id,v_conn.id,p_data->>'requestKey',p_data->>'digest',(p_data->>'expectedRevision')::bigint,p_data->'document',coalesce(p_data->'result','{}'::jsonb),v_scopes,greatest(coalesce((p_data->>'amountPaisa')::bigint,0),(v_changes->>'amountPaisa')::bigint),coalesce(p_data->'source','{}'::jsonb),v_expiry) returning * into v_proposal;
    return jsonb_build_object('status','pending','proposalId',v_proposal.id,'expiresAt',v_proposal.expires_at,'result',v_proposal.result);
  elsif p_action='list_proposals' then
    v_owner:=(p_data->>'ownerId')::uuid;
    return jsonb_build_object('proposals',coalesce((select jsonb_agg(x.row order by x.at desc,x.id) from (select p.id,p.created_at at,jsonb_build_object('id',p.id,'connectionId',p.connection_id,'actorName',c.name,'requestKey',p.request_key,'digest',p.digest,'expectedRevision',p.expected_revision,'document',p.document,'result',p.result,'requiredScopes',to_jsonb(p.required_scopes),'amountPaisa',p.amount_paisa,'source',p.source,'status',case when p.expires_at<=v_now and p.status in ('pending','approved') then 'expired' else p.status end,'createdAt',p.created_at,'expiresAt',p.expires_at,'approvedAt',p.approved_at,'committedAt',p.committed_at) row from private.mcp_proposals p join private.mcp_connections c on c.id=p.connection_id where p.owner_id=v_owner order by p.created_at desc,p.id limit 100) x),'[]'::jsonb));
  elsif p_action='approve_proposal' then
    if jsonb_typeof(p_data->'approve') is distinct from 'boolean' then raise exception 'mcp_invalid_request'; end if;
    select * into v_proposal from private.mcp_proposals where owner_id=(p_data->>'ownerId')::uuid and id=coalesce(p_data->>'proposalId',p_data->>'id')::uuid for update;
    if not found then raise exception 'mcp_not_found'; end if;
    if v_proposal.status not in ('pending','approved') then raise exception 'mcp_proposal_rejected'; end if;
    if v_proposal.expires_at<=v_now then raise exception 'mcp_proposal_expired'; end if;
    update private.mcp_proposals set status=case when (p_data->>'approve')::boolean then 'approved' else 'rejected' end,approved_at=v_now where id=v_proposal.id returning * into v_proposal;
    return jsonb_build_object('proposalId',v_proposal.id,'status',v_proposal.status);
  elsif p_action='commit_proposal' then
    return private.mcp_apply(p_data->>'tokenHash',p_data,coalesce(p_data->>'proposalId',p_data->>'id')::uuid);
  elsif p_action='register_client' then
    v_method:=coalesce(p_data->>'tokenEndpointAuthMethod','none');
    if jsonb_typeof(p_data->'redirectUris') is distinct from 'array' or jsonb_array_length(p_data->'redirectUris') not between 1 and 20 then raise exception 'mcp_invalid_request'; end if;
    for v_uri in select jsonb_array_elements_text(p_data->'redirectUris') loop
      if length(v_uri)>2048 or v_uri ~ '[#@\s]' or not(v_uri ~ '^https://[^/]+(?:/|$)' or v_uri ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?(?:/|$)') then raise exception 'mcp_invalid_redirect_uri'; end if;
    end loop;
    if v_method<>'none' and coalesce(p_data->>'clientSecretHash','') !~ '^[0-9a-f]{64}$' then raise exception 'mcp_invalid_request'; end if;
    insert into private.mcp_clients(client_id,client_name,redirect_uris,auth_method,secret_hash,scopes)
      values(p_data->>'clientId',coalesce(p_data->>'clientName','Assistant'),p_data->'redirectUris',v_method,nullif(p_data->>'clientSecretHash',''),private.mcp_scopes(p_data->'scope')) returning * into v_client;
    return jsonb_build_object('clientId',v_client.client_id,'clientName',v_client.client_name,'redirectUris',v_client.redirect_uris,'tokenEndpointAuthMethod',v_client.auth_method,'scope',array_to_string(v_client.scopes,' '),'createdAt',v_client.created_at);
  elsif p_action='get_client' then
    select * into v_client from private.mcp_clients where client_id=p_data->>'clientId';
    if not found then return null; end if;
    return jsonb_build_object('clientId',v_client.client_id,'clientName',v_client.client_name,'redirectUris',v_client.redirect_uris,'tokenEndpointAuthMethod',v_client.auth_method,'clientSecretHash',v_client.secret_hash,'scope',array_to_string(v_client.scopes,' '));
  elsif p_action='begin_authorization' then
    select * into v_client from private.mcp_clients where client_id=p_data->>'clientId';
    if not found then raise exception 'mcp_invalid_client'; end if;
    if not(v_client.redirect_uris @> jsonb_build_array(p_data->>'redirectUri')) then raise exception 'mcp_invalid_redirect_uri'; end if;
    v_scopes:=private.mcp_scopes(p_data->'scopes');
    if not('ledger:read'=any(v_scopes)) or not(v_client.scopes @> v_scopes) then raise exception 'mcp_invalid_scope'; end if;
    insert into private.mcp_authorizations(id,client_id,redirect_uri,scopes,code_challenge,resource,state)
      values(coalesce((p_data->>'requestId')::uuid,gen_random_uuid()),v_client.client_id,p_data->>'redirectUri',v_scopes,p_data->>'codeChallenge',p_data->>'resource',coalesce(p_data->>'state','')) returning * into v_auth;
    return jsonb_build_object('requestId',v_auth.id,'expiresAt',v_auth.expires_at);
  elsif p_action='authorization_details' then
    select * into v_auth from private.mcp_authorizations where id=(p_data->>'requestId')::uuid;
    if not found or v_auth.expires_at<=v_now or v_auth.approved_at is not null then raise exception 'mcp_not_found'; end if;
    select * into v_client from private.mcp_clients where client_id=v_auth.client_id;
    return jsonb_build_object('requestId',v_auth.id,'clientId',v_auth.client_id,'clientName',v_client.client_name,'redirectUri',v_auth.redirect_uri,'scopes',to_jsonb(v_auth.scopes),'resource',v_auth.resource,'state',v_auth.state,'expiresAt',v_auth.expires_at);
  elsif p_action='deny_authorization' then
    if p_data->>'ownerId' is null then raise exception 'mcp_invalid_request'; end if;
    select * into v_auth from private.mcp_authorizations where id=(p_data->>'requestId')::uuid for update;
    if not found or v_auth.expires_at<=v_now or v_auth.approved_at is not null then raise exception 'mcp_invalid_grant'; end if;
    update private.mcp_authorizations set approved_at=v_now where id=v_auth.id;
    return jsonb_build_object('redirectUri',v_auth.redirect_uri,'state',v_auth.state);
  elsif p_action='approve_authorization' then
    select * into v_auth from private.mcp_authorizations where id=(p_data->>'requestId')::uuid for update;
    if not found or v_auth.expires_at<=v_now or v_auth.approved_at is not null then raise exception 'mcp_invalid_grant'; end if;
    v_scopes:=private.mcp_scopes(p_data->'scopes');
    if not('ledger:read'=any(v_scopes)) or not(v_auth.scopes @> v_scopes) then raise exception 'mcp_invalid_scope'; end if;
    select * into v_client from private.mcp_clients where client_id=v_auth.client_id;
    insert into private.mcp_connections(owner_id,client_id,name,scopes,policy)
      values((p_data->>'ownerId')::uuid,v_auth.client_id,coalesce(nullif(btrim(p_data->>'name'),''),v_client.client_name),v_scopes,private.mcp_policy(p_data->'policy')) returning * into v_conn;
    insert into private.mcp_codes(code_hash,connection_id,client_id,redirect_uri,code_challenge,resource)
      values(p_data->>'codeHash',v_conn.id,v_conn.client_id,v_auth.redirect_uri,v_auth.code_challenge,v_auth.resource);
    update private.mcp_authorizations set approved_at=v_now where id=v_auth.id;
    return jsonb_build_object('redirectUri',v_auth.redirect_uri,'state',v_auth.state,'connectionId',v_conn.id);
  elsif p_action='exchange_code' then
    select * into v_code from private.mcp_codes where code_hash=p_data->>'codeHash' for update;
    if not found or v_code.used_at is not null or v_code.expires_at<=v_now or v_code.client_id is distinct from p_data->>'clientId' or v_code.redirect_uri is distinct from p_data->>'redirectUri' or v_code.code_challenge is distinct from p_data->>'codeChallenge' or v_code.resource is distinct from p_data->>'resource' then raise exception 'mcp_invalid_grant'; end if;
    select * into v_conn from private.mcp_connections where id=v_code.connection_id for update;
    if v_conn.revoked_at is not null then raise exception 'mcp_invalid_grant'; end if;
    v_family:=gen_random_uuid();
    insert into private.mcp_tokens(token_hash,connection_id,kind,client_id,family_id,resource,expires_at) values
      (p_data->>'accessHash',v_conn.id,'access',v_conn.client_id,v_family,v_code.resource,v_now+interval '1 hour'),
      (p_data->>'refreshHash',v_conn.id,'refresh',v_conn.client_id,v_family,v_code.resource,v_now+interval '30 days');
    update private.mcp_codes set used_at=v_now where code_hash=v_code.code_hash;
    return jsonb_build_object('connection',private.mcp_connection_json(v_conn),'expiresIn',3600,'scope',array_to_string(v_conn.scopes,' '),'refreshExpiresAt',v_now+interval '30 days');
  elsif p_action='refresh' then
    select * into v_token from private.mcp_tokens where token_hash=p_data->>'refreshHash' and kind='refresh';
    if not found or v_token.client_id is distinct from p_data->>'clientId' then raise exception 'mcp_invalid_grant'; end if;
    select * into v_conn from private.mcp_connections where id=v_token.connection_id for update;
    select * into v_token from private.mcp_tokens where token_hash=p_data->>'refreshHash' for update;
    if v_conn.revoked_at is not null or v_token.expires_at<=v_now then raise exception 'mcp_invalid_grant'; end if;
    if v_token.resource is distinct from p_data->>'resource' then raise exception 'mcp_invalid_grant'; end if;
    if v_token.used_at is not null or v_token.revoked_at is not null then
      update private.mcp_tokens set revoked_at=coalesce(revoked_at,v_now) where family_id=v_token.family_id;
      return jsonb_build_object('error','invalid_grant');
    end if;
    update private.mcp_tokens set revoked_at=v_now,used_at=v_now where token_hash=v_token.token_hash;
    insert into private.mcp_tokens(token_hash,connection_id,kind,client_id,family_id,resource,expires_at) values
      (p_data->>'accessHash',v_conn.id,'access',v_conn.client_id,v_token.family_id,v_token.resource,v_now+interval '1 hour'),
      (p_data->>'newRefreshHash',v_conn.id,'refresh',v_conn.client_id,v_token.family_id,v_token.resource,v_now+interval '30 days');
    return jsonb_build_object('connection',private.mcp_connection_json(v_conn),'expiresIn',3600,'scope',array_to_string(v_conn.scopes,' '),'refreshExpiresAt',v_now+interval '30 days');
  elsif p_action='revoke_token' then
    select * into v_token from private.mcp_tokens where token_hash=coalesce(p_data->>'tokenHash',p_data->>'hash');
    if not found or v_token.client_id is distinct from p_data->>'clientId' then return '{}'::jsonb; end if;
    perform 1 from private.mcp_connections where id=v_token.connection_id for update;
    update private.mcp_tokens set revoked_at=coalesce(revoked_at,v_now) where family_id=v_token.family_id;
    return '{}'::jsonb;
  elsif p_action='create_upload' then
    v_conn:=private.mcp_auth(p_data->>'tokenHash',true,p_data->>'resource');
    if not('receipts:write'=any(v_conn.scopes)) then raise exception 'mcp_scope_required'; end if;
    if p_data->>'path' is distinct from v_conn.owner_id::text||'/'||(p_data->>'id') then raise exception 'mcp_forbidden'; end if;
    select * into v_asset from private.mcp_assets where owner_id=v_conn.owner_id and id=p_data->>'id';
    if found then
      if v_asset.connection_id<>v_conn.id or v_asset.path is distinct from p_data->>'path' or v_asset.name is distinct from p_data->>'name' or v_asset.mime is distinct from p_data->>'mime' or v_asset.size is distinct from (p_data->>'size')::bigint or v_asset.sha256 is distinct from nullif(p_data->>'sha256','') then raise exception 'mcp_operation_mismatch'; end if;
      return private.mcp_asset_json(v_asset);
    end if;
    if exists(select 1 from storage.objects where bucket_id='bari-receipts' and name=p_data->>'path') then raise exception 'mcp_operation_mismatch'; end if;
    if (select count(*) from private.mcp_assets where owner_id=v_conn.owner_id and status='pending' and expires_at>v_now)>=50 then raise exception 'mcp_upload_limit'; end if;
    insert into private.mcp_assets(owner_id,id,connection_id,path,name,mime,size,sha256)
      values(v_conn.owner_id,p_data->>'id',v_conn.id,p_data->>'path',p_data->>'name',p_data->>'mime',(p_data->>'size')::bigint,nullif(p_data->>'sha256','')) returning * into v_asset;
    return private.mcp_asset_json(v_asset);
  elsif p_action='finalize_upload' then
    v_conn:=private.mcp_auth(p_data->>'tokenHash',true,p_data->>'resource');
    if not('receipts:write'=any(v_conn.scopes)) then raise exception 'mcp_scope_required'; end if;
    select * into v_asset from private.mcp_assets where owner_id=v_conn.owner_id and id=p_data->>'id' and connection_id=v_conn.id for update;
    if not found then raise exception 'mcp_not_found'; end if;
    if v_asset.status='uploaded' then return private.mcp_asset_json(v_asset); end if;
    if v_asset.expires_at<=v_now then raise exception 'mcp_upload_expired'; end if;
    v_hash:=nullif(p_data->>'sha256','');
    if v_hash is null or v_hash !~ '^[0-9a-f]{64}$' or (v_asset.sha256 is not null and v_asset.sha256<>v_hash) then raise exception 'mcp_invalid_receipt'; end if;
    if p_data ? 'path' and p_data->>'path' is distinct from v_asset.path then raise exception 'mcp_forbidden'; end if;
    update private.mcp_assets set status='uploaded',sha256=v_hash,uploaded_at=v_now where owner_id=v_conn.owner_id and id=v_asset.id returning * into v_asset;
    return private.mcp_asset_json(v_asset);
  elsif p_action in ('asset','list_assets') then
    v_conn:=private.mcp_auth(p_data->>'tokenHash',false,p_data->>'resource');
    if not('receipts:read'=any(v_conn.scopes) or 'receipts:write'=any(v_conn.scopes)) then raise exception 'mcp_scope_required'; end if;
    if p_action='asset' then
      select * into v_asset from private.mcp_assets where owner_id=v_conn.owner_id and id=p_data->>'id';
      if not found then raise exception 'mcp_not_found'; end if;
      if v_asset.status='pending' and v_asset.expires_at<=v_now then raise exception 'mcp_upload_expired'; end if;
      return private.mcp_asset_json(v_asset);
    end if;
    v_limit:=least(100,greatest(1,coalesce((p_data->>'limit')::integer,30))); v_offset:=greatest(0,coalesce((p_data->>'offset')::integer,0));
    return jsonb_build_object('assets',coalesce((select jsonb_agg(private.mcp_asset_json(a) order by a.created_at desc,a.id) from (select * from private.mcp_assets where owner_id=v_conn.owner_id order by created_at desc,id limit v_limit offset v_offset) a),'[]'::jsonb));
  else raise exception 'mcp_invalid_action'; end if;
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range or not_null_violation then raise exception 'mcp_invalid_request';
  when check_violation then raise exception 'mcp_invalid_document';
  when unique_violation then raise exception 'mcp_operation_mismatch';
end;
$$;

create function public.mcp_receipt_is_immutable(p_path text)
returns boolean language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select exists(select 1 from private.mcp_assets where owner_id=(select auth.uid()) and path=p_path);
$$;
create policy mcp_receipt_no_replacement on storage.objects as restrictive for update to authenticated
  using(bucket_id<>'bari-receipts' or not public.mcp_receipt_is_immutable(name))
  with check(bucket_id<>'bari-receipts' or not public.mcp_receipt_is_immutable(name));
create policy mcp_receipt_no_removal on storage.objects as restrictive for delete to authenticated
  using(bucket_id<>'bari-receipts' or not public.mcp_receipt_is_immutable(name));

create function public.preserve_mcp_provenance()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare v_old jsonb; v_new jsonb; v_revision jsonb; v_count integer; v_index integer;
begin
  for v_old in select value from jsonb_array_elements(old.document->'entries') loop
    select value into v_new from jsonb_array_elements(new.document->'entries') e where e->>'id'=v_old->>'id';
    if coalesce(v_old->'provenance','null'::jsonb)<>'null'::jsonb then
      if v_new is null or coalesce(v_new->'provenance','null'::jsonb)='null'::jsonb then raise exception 'ledger_provenance_would_be_lost'; end if;
      if v_old->'provenance' is distinct from v_new->'provenance' then
        v_count:=jsonb_array_length(coalesce(v_old->'revisions','[]'::jsonb));
        if v_new#>array['revisions',v_count::text,'before','provenance'] is distinct from v_old->'provenance' then raise exception 'ledger_provenance_would_be_lost'; end if;
      end if;
    end if;
    v_index:=0;
    for v_revision in select value from jsonb_array_elements(coalesce(v_old->'revisions','[]'::jsonb)) loop
      if coalesce(v_revision#>'{before,provenance}','null'::jsonb)<>'null'::jsonb and (v_new is null or v_new#>array['revisions',v_index::text,'before','provenance'] is distinct from v_revision#>'{before,provenance}') then raise exception 'ledger_provenance_would_be_lost'; end if;
      v_index:=v_index+1;
    end loop;
  end loop;
  return new;
end;
$$;
create trigger ledger_preserve_mcp_provenance before update of document on public.ledger_documents for each row execute function public.preserve_mcp_provenance();

create function public.ledger_mcp_provenance_is_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_provenance jsonb; v_time timestamptz;
begin
  for v_provenance in
    select e->'provenance' from jsonb_array_elements(p_document->'entries') e
    union all select r#>'{before,provenance}' from jsonb_array_elements(p_document->'entries') e cross join lateral jsonb_array_elements(coalesce(e->'revisions','[]'::jsonb)) r
  loop
    if v_provenance is null or v_provenance='null'::jsonb then continue; end if;
    if jsonb_typeof(v_provenance)<>'object' or v_provenance->'version' is distinct from '1'::jsonb
      or coalesce(v_provenance->>'origin','') not in ('text','image','voice')
      or jsonb_typeof(v_provenance->'connectionId') is distinct from 'string' or length(btrim(v_provenance->>'connectionId')) not between 1 and 160
      or jsonb_typeof(v_provenance->'actorName') is distinct from 'string' or length(btrim(v_provenance->>'actorName')) not between 1 and 200
      or (coalesce(v_provenance->'sourceEventId','null'::jsonb)<>'null'::jsonb and (jsonb_typeof(v_provenance->'sourceEventId')<>'string' or length(btrim(v_provenance->>'sourceEventId')) not between 1 and 160))
      or jsonb_typeof(coalesce(v_provenance->'assetDigests','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(v_provenance->'assetDigests','[]'::jsonb))>30
      or exists(select 1 from jsonb_array_elements(coalesce(v_provenance->'assetDigests','[]'::jsonb)) d where jsonb_typeof(d)<>'string' or length(d#>>'{}') not between 1 and 128)
      or (v_provenance ? 'reason' and (jsonb_typeof(v_provenance->'reason')<>'string' or length(v_provenance->>'reason')>2000))
      or jsonb_typeof(v_provenance->'recordedAt') is distinct from 'string' or v_provenance->>'recordedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then return false; end if;
    v_time:=(v_provenance->>'recordedAt')::timestamptz;
  end loop;
  return true;
exception when others then return false;
end;
$$;
alter table public.ledger_documents add constraint ledger_mcp_provenance_valid check(public.ledger_mcp_provenance_is_valid(document)) not valid;

revoke all on function public.mcp_server(text,jsonb) from public,anon,authenticated;
grant execute on function public.mcp_server(text,jsonb) to service_role;
revoke all on function public.mcp_receipt_is_immutable(text) from public,anon;
grant execute on function public.mcp_receipt_is_immutable(text) to authenticated;
revoke all on function public.preserve_mcp_provenance() from public,anon,authenticated;
revoke all on function public.ledger_mcp_provenance_is_valid(jsonb) from public,anon;
grant execute on function public.ledger_mcp_provenance_is_valid(jsonb) to authenticated,service_role;
revoke all on function private.mcp_scopes(jsonb),private.mcp_policy(jsonb),private.mcp_connection_json(private.mcp_connections),private.mcp_auth(text,boolean,text),private.mcp_comparable(jsonb,text),private.mcp_document_changes(jsonb,jsonb),private.mcp_asset_json(private.mcp_assets),private.mcp_apply(text,jsonb,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';

commit;

begin;

create table private.mcp_upload_cleanup_claims (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9_-]{1,160}$'),
  claimed_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key(owner_id,id)
);
alter table private.mcp_upload_cleanup_claims enable row level security;
revoke all on private.mcp_upload_cleanup_claims from public,anon,authenticated;

create function private.mcp_receipt_ids(p_document jsonb)
returns setof text language sql immutable set search_path=pg_catalog,pg_temp as $$
  select r#>>'{}' from jsonb_path_query(p_document,'$.entries[*].receipts[*].id') r
  union all select r#>>'{}' from jsonb_path_query(p_document,'$.entries[*].revisions[*].before.receipts[*].id') r;
$$;

create function private.mcp_upload_is_referenced(p_owner uuid,p_id text)
returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
  select exists(select 1 from public.ledger_documents d cross join lateral private.mcp_receipt_ids(d.document) r(id) where d.owner_id=p_owner and r.id=p_id)
    or exists(select 1 from private.mcp_proposals p cross join lateral private.mcp_receipt_ids(p.document) r(id) where p.owner_id=p_owner and p.status in ('pending','approved') and p.expires_at>clock_timestamp() and r.id=p_id);
$$;

create function public.block_cleaned_mcp_receipts()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text,0));
  if exists(select 1 from private.mcp_upload_cleanup_claims c join private.mcp_receipt_ids(new.document) r(id) on r.id=c.id where c.owner_id=new.owner_id) then raise exception 'mcp_upload_expired'; end if;
  return new;
end;
$$;
create trigger ledger_block_cleaned_mcp_receipts before insert or update of document on public.ledger_documents for each row execute function public.block_cleaned_mcp_receipts();
create trigger proposal_block_cleaned_mcp_receipts before insert or update of document on private.mcp_proposals for each row execute function public.block_cleaned_mcp_receipts();

create function private.mcp_block_upload_reuse()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if exists(select 1 from private.mcp_upload_cleanup_claims where owner_id=new.owner_id and id=new.id) then raise exception 'mcp_upload_expired'; end if;
  return new;
end;
$$;
create trigger asset_block_cleaned_mcp_upload before insert on private.mcp_assets for each row execute function private.mcp_block_upload_reuse();

create function public.mcp_upload_cleanup(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_asset private.mcp_assets; v_candidate record; v_owner uuid; v_id text; v_limit integer; v_uploads jsonb:='[]'::jsonb;
begin
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'mcp_invalid_request'; end if;
  if p_action='list' then
    v_limit:=least(100,greatest(1,coalesce((p_data->>'limit')::integer,100)));
    for v_candidate in select owner_id,id from private.mcp_assets where status='pending' and expires_at<=clock_timestamp()-interval '2 hours'
      and (not(p_data ? 'ownerId') or owner_id=(p_data->>'ownerId')::uuid)
      and not private.mcp_upload_is_referenced(owner_id,id) order by owner_id,id limit v_limit loop
      perform pg_advisory_xact_lock(hashtextextended(v_candidate.owner_id::text,0));
      select * into v_asset from private.mcp_assets where owner_id=v_candidate.owner_id and id=v_candidate.id for update;
      if not found or v_asset.status<>'pending' or v_asset.expires_at>clock_timestamp()-interval '2 hours' or private.mcp_upload_is_referenced(v_asset.owner_id,v_asset.id) then continue; end if;
      insert into private.mcp_upload_cleanup_claims(owner_id,id) values(v_asset.owner_id,v_asset.id) on conflict(owner_id,id) do nothing;
      v_uploads:=v_uploads||jsonb_build_array(jsonb_build_object('ownerId',v_asset.owner_id,'id',v_asset.id,'stagingPath',v_asset.owner_id::text||'/.mcp-staging/'||v_asset.id,'chunkPrefix',v_asset.owner_id::text||'/.mcp-chunks/'||v_asset.id,'activePath',v_asset.owner_id::text||'/'||v_asset.id));
    end loop;
    return jsonb_build_object('uploads',v_uploads);
  elsif p_action='ack' then
    v_owner:=(p_data->>'ownerId')::uuid; v_id:=p_data->>'id';
    if v_owner is null or coalesce(v_id,'') !~ '^[A-Za-z0-9_-]{1,160}$' then raise exception 'mcp_invalid_request'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_owner::text,0));
    if not exists(select 1 from private.mcp_upload_cleanup_claims where owner_id=v_owner and id=v_id) then raise exception 'mcp_not_found'; end if;
    select * into v_asset from private.mcp_assets where owner_id=v_owner and id=v_id for update;
    if not found then return jsonb_build_object('deleted',true,'alreadyDone',true); end if;
    if v_asset.status<>'pending' or v_asset.expires_at>clock_timestamp()-interval '2 hours' or private.mcp_upload_is_referenced(v_owner,v_id) then return jsonb_build_object('deleted',false,'reason','protected'); end if;
    delete from private.mcp_assets where owner_id=v_owner and id=v_id;
    update private.mcp_upload_cleanup_claims set deleted_at=coalesce(deleted_at,clock_timestamp()) where owner_id=v_owner and id=v_id;
    return jsonb_build_object('deleted',true);
  else raise exception 'mcp_invalid_action'; end if;
exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'mcp_invalid_request';
end;
$$;

revoke all on function private.mcp_receipt_ids(jsonb),private.mcp_upload_is_referenced(uuid,text),private.mcp_block_upload_reuse(),public.block_cleaned_mcp_receipts() from public,anon,authenticated;
revoke all on function public.mcp_upload_cleanup(text,jsonb) from public,anon,authenticated;
grant execute on function public.mcp_upload_cleanup(text,jsonb) to service_role;
notify pgrst,'reload schema';

commit;

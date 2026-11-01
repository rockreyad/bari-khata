create table public.ledger_documents (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null check (revision > 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.ledger_operations (
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  revision bigint not null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, request_id)
);

alter table public.ledger_documents enable row level security;
alter table public.ledger_operations enable row level security;

create policy own_ledger_read on public.ledger_documents
  for select to authenticated using (owner_id = (select auth.uid()));
create policy own_operations_read on public.ledger_operations
  for select to authenticated using (owner_id = (select auth.uid()));

revoke all on public.ledger_documents, public.ledger_operations from anon, authenticated;
grant select on public.ledger_documents, public.ledger_operations to authenticated;

create function public.load_ledger_snapshot()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_document public.ledger_documents;
begin
  if v_owner is null then raise exception 'authentication_required'; end if;
  select * into v_document from public.ledger_documents where owner_id = v_owner;
  if not found then
    return jsonb_build_object('revision', 0, 'document', null, 'updatedAt', null);
  end if;
  return jsonb_build_object('revision', v_document.revision,
    'document', v_document.document, 'updatedAt', v_document.updated_at);
end;
$$;

create function public.save_ledger_snapshot(
  p_request_id uuid,
  p_expected_revision bigint,
  p_document jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_owner uuid := auth.uid();
  v_existing public.ledger_documents;
  v_operation public.ledger_operations;
  v_revision bigint;
  v_updated timestamptz := now();
begin
  if v_owner is null then raise exception 'authentication_required'; end if;
  if jsonb_typeof(p_document) <> 'object' or p_document is null
     or octet_length(p_document::text) > 10485760 then
    raise exception 'invalid_document';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 or p_request_id is null then
    raise exception 'invalid_revision';
  end if;

  -- Serialize a user's first save too, when there is no row to lock yet.
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 0));
  select * into v_operation from public.ledger_operations
    where owner_id = v_owner and request_id = p_request_id;
  if found then
    if v_operation.payload_hash <> md5(p_document::text) then
      raise exception 'operation_payload_mismatch';
    end if;
    return jsonb_build_object('status', 'saved', 'revision', v_operation.revision,
      'updatedAt', v_operation.created_at);
  end if;

  select * into v_existing from public.ledger_documents where owner_id = v_owner;
  v_revision := coalesce(v_existing.revision, 0);
  if v_revision <> p_expected_revision then
    return jsonb_build_object('status', 'conflict', 'revision', v_revision,
      'document', v_existing.document, 'updatedAt', v_existing.updated_at);
  end if;

  v_revision := v_revision + 1;
  insert into public.ledger_documents(owner_id, revision, document, updated_at)
    values (v_owner, v_revision, p_document, v_updated)
    on conflict (owner_id) do update set revision = excluded.revision,
      document = excluded.document, updated_at = excluded.updated_at;
  insert into public.ledger_operations(owner_id, request_id, revision, payload_hash, created_at)
    values(v_owner, p_request_id, v_revision, md5(p_document::text), v_updated);
  return jsonb_build_object('status', 'saved', 'revision', v_revision, 'updatedAt', v_updated);
end;
$$;

revoke all on function public.load_ledger_snapshot() from public, anon;
revoke all on function public.save_ledger_snapshot(uuid, bigint, jsonb) from public, anon;
grant execute on function public.load_ledger_snapshot() to authenticated;
grant execute on function public.save_ledger_snapshot(uuid, bigint, jsonb) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values('bari-receipts', 'bari-receipts', false, 10485760,
    array['image/jpeg','image/png','image/webp','application/pdf'])
  on conflict (id) do nothing;

create policy receipt_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'bari-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy receipt_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'bari-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy receipt_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'bari-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'bari-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy receipt_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'bari-receipts' and (storage.foldername(name))[1] = (select auth.uid())::text);

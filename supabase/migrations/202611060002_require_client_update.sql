begin;

create function private.minimum_supported_client_version()
returns text language sql immutable set search_path=pg_catalog,pg_temp as $$
  select '0.1.4'::text;
$$;

create function private.client_version_is_supported(p_version text)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
begin
  if p_version is null or length(p_version)>64
    or p_version !~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' then
    return false;
  end if;
  return string_to_array(p_version,'.')::numeric[] >=
    string_to_array(private.minimum_supported_client_version(),'.')::numeric[];
end;
$$;

create function private.assert_supported_client_version()
returns void language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare v_headers jsonb;
begin
  -- MCP ও রক্ষণাবেক্ষণের service role অ্যাপের সংস্করণ পাঠায় না।
  if (select auth.role())='service_role' then return; end if;
  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  exception when invalid_text_representation then
    v_headers:='{}'::jsonb;
  end;
  if jsonb_typeof(v_headers)='object'
    and private.client_version_is_supported(v_headers->>'x-bari-client-version') then
    return;
  end if;
  raise sqlstate 'PT426' using message='client_update_required',
    detail=jsonb_build_object('minimumSupportedVersion',private.minimum_supported_client_version())::text;
end;
$$;

alter function public.save_ledger_snapshot(uuid,bigint,jsonb) set schema private;
alter function private.save_ledger_snapshot(uuid,bigint,jsonb)
  rename to save_ledger_snapshot_before_update_gate;
revoke all on function private.save_ledger_snapshot_before_update_gate(uuid,bigint,jsonb)
  from public,anon,authenticated,service_role;

create function public.save_ledger_snapshot(
  p_request_id uuid,p_expected_revision bigint,p_document jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform private.assert_supported_client_version();
  return private.save_ledger_snapshot_before_update_gate(p_request_id,p_expected_revision,p_document);
end;
$$;

create function public.current_client_can_write(p_bucket text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
begin
  if p_bucket in ('bari-receipts','bari-mcp-staging') then
    perform private.assert_supported_client_version();
  end if;
  return true;
end;
$$;

revoke all on function private.minimum_supported_client_version(),
  private.client_version_is_supported(text),private.assert_supported_client_version()
  from public,anon,authenticated,service_role;
revoke all on function public.save_ledger_snapshot(uuid,bigint,jsonb),
  public.current_client_can_write(text) from public,anon,authenticated,service_role;
grant execute on function public.save_ledger_snapshot(uuid,bigint,jsonb),
  public.current_client_can_write(text) to authenticated,service_role;

create policy receipt_current_client_insert on storage.objects
as restrictive for insert to authenticated
with check (public.current_client_can_write(bucket_id));

create policy receipt_current_client_update on storage.objects
as restrictive for update to authenticated
using (public.current_client_can_write(bucket_id))
with check (public.current_client_can_write(bucket_id));

create policy receipt_current_client_delete on storage.objects
as restrictive for delete to authenticated
using (public.current_client_can_write(bucket_id));

notify pgrst,'reload schema';

commit;

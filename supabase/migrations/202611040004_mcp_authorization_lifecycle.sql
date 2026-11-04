begin;

alter table private.mcp_connections add column last_used_at timestamptz;
create index mcp_authorizations_flow on private.mcp_authorizations(client_id,code_challenge,created_at desc);

create or replace function private.mcp_connection_json(p_connection private.mcp_connections)
returns jsonb language sql stable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object('id',p_connection.id,'ownerId',p_connection.owner_id,'clientId',p_connection.client_id,'name',p_connection.name,'scopes',to_jsonb(p_connection.scopes),'policy',p_connection.policy,'createdAt',p_connection.created_at,'lastUsedAt',p_connection.last_used_at,'expiresAt',p_connection.expires_at,'revokedAt',p_connection.revoked_at);
$$;

alter function public.mcp_server(text,jsonb) set schema private;
alter function private.mcp_server(text,jsonb) rename to mcp_server_before_authorization_lifecycle;
revoke all on function private.mcp_server_before_authorization_lifecycle(text,jsonb) from public,anon,authenticated,service_role;

create function public.mcp_server(p_action text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  v_auth private.mcp_authorizations; v_client private.mcp_clients; v_conn private.mcp_connections;
  v_scopes text[]; v_result jsonb; v_now timestamptz;
begin
  if p_action is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>11534336 then raise exception 'mcp_invalid_request'; end if;
  if p_action='begin_authorization' then
    select * into v_client from private.mcp_clients where client_id=p_data->>'clientId';
    if not found then raise exception 'mcp_invalid_client'; end if;
    if not(v_client.redirect_uris @> jsonb_build_array(p_data->>'redirectUri')) then raise exception 'mcp_invalid_redirect_uri'; end if;
    v_scopes:=private.mcp_scopes(p_data->'scopes');
    if not('ledger:read'=any(v_scopes)) or not(v_client.scopes @> v_scopes) then raise exception 'mcp_invalid_scope'; end if;
    -- একই অনুমতির পাতাটি একসঙ্গে খুললেও একটি অনুরোধই থাকবে; আলাদা PKCE/state/client মেলানো হবে না।
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('mcp-authorization',p_data->>'clientId',p_data->>'redirectUri',p_data->>'codeChallenge',p_data->>'resource',coalesce(p_data->>'state',''))::text,0));
    v_now:=clock_timestamp();
    select * into v_auth from private.mcp_authorizations
      where client_id=v_client.client_id and redirect_uri=p_data->>'redirectUri' and code_challenge=p_data->>'codeChallenge'
        and resource=p_data->>'resource' and state=coalesce(p_data->>'state','') and expires_at>v_now
      order by created_at,id limit 1 for update;
    if found then
      if v_auth.scopes is distinct from v_scopes then raise exception 'mcp_invalid_scope'; end if;
      return jsonb_build_object('requestId',v_auth.id,'expiresAt',v_auth.expires_at);
    end if;
  end if;
  v_result:=private.mcp_server_before_authorization_lifecycle(p_action,p_data);
  if p_action='authenticate' then
    update private.mcp_connections set last_used_at=clock_timestamp()
      where id=(v_result#>>'{connection,id}')::uuid and revoked_at is null returning * into v_conn;
    if found then v_result:=jsonb_set(v_result,'{connection}',private.mcp_connection_json(v_conn)); end if;
  end if;
  return v_result;
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range or not_null_violation then raise exception 'mcp_invalid_request';
  when check_violation then raise exception 'mcp_invalid_document';
end;
$$;

revoke all on function public.mcp_server(text,jsonb) from public,anon,authenticated;
grant execute on function public.mcp_server(text,jsonb) to service_role;
notify pgrst,'reload schema';

commit;

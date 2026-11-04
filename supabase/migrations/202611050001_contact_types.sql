begin;

create function public.contact_types_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
  v_person jsonb;
  v_type text;
  v_kind text;
begin
  for v_person in select value from jsonb_array_elements(p_document->'people') loop
    if v_person ? 'contactType' and v_person->'contactType'<>'null'::jsonb then
      v_type:=v_person->>'contactType';
      v_kind:=v_person->>'kind';
      if jsonb_typeof(v_person->'contactType') is distinct from 'string'
        or v_type not in ('supplier','craftsperson','labour','contractor','professional','transport','service','custom') then return false; end if;
      if v_kind is not null and v_type<>'custom' then
        if v_type='supplier' and v_kind<>'shop' then return false; end if;
        if v_type='transport' and v_kind<>'driver' then return false; end if;
        if v_type in ('craftsperson','labour','contractor','professional','service') and v_kind not in ('worker','other') then return false; end if;
      end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function public.preserve_contact_types()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare
  v_person jsonb;
  v_next jsonb;
begin
  for v_person in select value from jsonb_array_elements(old.document->'people') loop
    if v_person ? 'contactType' and v_person->'contactType'<>'null'::jsonb then
      select value into v_next from jsonb_array_elements(new.document->'people') where value->>'id'=v_person->>'id';
      if v_next is null or not(v_next ? 'contactType') then
        raise exception 'contact_type_would_be_lost';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

alter table public.ledger_documents add constraint contact_types_valid
check(public.contact_types_are_valid(document)) not valid;
create trigger ledger_preserve_contact_types before update of document on public.ledger_documents
for each row execute function public.preserve_contact_types();
revoke all on function public.contact_types_are_valid(jsonb) from public,anon;
grant execute on function public.contact_types_are_valid(jsonb) to authenticated,service_role;
revoke all on function public.preserve_contact_types() from public,anon,authenticated;
notify pgrst,'reload schema';

commit;

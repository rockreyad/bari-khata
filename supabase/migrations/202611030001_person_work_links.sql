begin;

create function public.person_work_links_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
  v_person jsonb;
  v_links jsonb;
begin
  for v_person in select value from jsonb_array_elements(p_document->'people') loop
    if v_person ? 'workIds' then
      v_links:=v_person->'workIds';
      if jsonb_typeof(v_links) is distinct from 'array' or jsonb_array_length(v_links)>10000 then return false; end if;
      if exists(select 1 from jsonb_array_elements(v_links) where jsonb_typeof(value) is distinct from 'string' or length(btrim(value #>> '{}')) not between 1 and 160) then return false; end if;
      if (select count(*)<>count(distinct value) from jsonb_array_elements(v_links)) then return false; end if;
      if exists(select 1 from jsonb_array_elements_text(v_links) as link(work_id) where not exists(select 1 from jsonb_array_elements(p_document->'works') as work where work->>'id'=link.work_id)) then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function public.preserve_person_work_links()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare
  v_person jsonb;
  v_next jsonb;
begin
  for v_person in select value from jsonb_array_elements(old.document->'people') loop
    if v_person ? 'workIds' then
      select value into v_next from jsonb_array_elements(new.document->'people') where value->>'id'=v_person->>'id';
      if v_next is null or not(v_next ? 'workIds') then
        raise exception 'person_work_links_would_be_lost';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

alter table public.ledger_documents add constraint person_work_links_valid check(public.person_work_links_are_valid(document)) not valid;
create trigger ledger_preserve_person_work_links before update of document on public.ledger_documents
for each row execute function public.preserve_person_work_links();
revoke all on function public.person_work_links_are_valid(jsonb) from public,anon;
grant execute on function public.person_work_links_are_valid(jsonb) to authenticated,service_role;
revoke all on function public.preserve_person_work_links() from public,anon,authenticated;
notify pgrst,'reload schema';

commit;

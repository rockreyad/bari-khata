begin;

create function public.ledger_removals_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
  v_group text;
  v_entity jsonb;
  v_history jsonb;
  v_event jsonb;
  v_last jsonb;
  v_previous_archived boolean;
  v_previous_at timestamptz;
  v_at timestamptz;
begin
  foreach v_group in array array['works','people','contracts'] loop
    for v_entity in select value from jsonb_array_elements(p_document->v_group) loop
      v_history:=coalesce(v_entity->'removalHistory','[]'::jsonb);
      if jsonb_typeof(v_history) is distinct from 'array' or jsonb_array_length(v_history)>2000 then return false; end if;
      if v_entity ? 'archivedAt' and v_entity->'archivedAt'<>'null'::jsonb and jsonb_typeof(v_entity->'archivedAt') is distinct from 'string' then return false; end if;
      if (select count(distinct value->>'id') from jsonb_array_elements(v_history))<>jsonb_array_length(v_history) then return false; end if;
      v_previous_archived:=false;
      v_previous_at:=null;
      v_last:=null;
      for v_event in select value from jsonb_array_elements(v_history) loop
        if jsonb_typeof(v_event) is distinct from 'object' or jsonb_typeof(v_event->'id') is distinct from 'string' or length(btrim(v_event->>'id')) not between 1 and 160 then return false; end if;
        if jsonb_typeof(v_event->'archived') is distinct from 'boolean' or (v_event->>'archived')::boolean=v_previous_archived then return false; end if;
        if jsonb_typeof(v_event->'at') is distinct from 'string' or v_event->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then return false; end if;
        v_at:=(v_event->>'at')::timestamptz;
        if v_previous_at is not null and v_at<v_previous_at then return false; end if;
        v_previous_at:=v_at;
        v_previous_archived:=(v_event->>'archived')::boolean;
        v_last:=v_event;
      end loop;
      if coalesce(v_entity->'archivedAt','null'::jsonb) is distinct from (case when v_previous_archived then v_last->'at' else 'null'::jsonb end) then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.ledger_evolution_is_valid(p_before jsonb, p_after jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
  v_previous jsonb;
  v_next jsonb;
  v_history jsonb;
  v_prefix jsonb;
  v_field text;
  v_group text;
begin
  if not public.ledger_removals_are_valid(p_after) then return false; end if;
  foreach v_group in array array['works','people','contracts'] loop
    for v_previous in select value from jsonb_array_elements(p_before->v_group) loop
      select value into v_next from jsonb_array_elements(p_after->v_group) where value->>'id'=v_previous->>'id';
      v_history:=coalesce(v_previous->'removalHistory','[]'::jsonb);
      if v_next is null then
        if jsonb_array_length(v_history)>0 or coalesce(v_previous->'archivedAt','null'::jsonb)<>'null'::jsonb then return false; end if;
      else
        if jsonb_typeof(coalesce(v_next->'removalHistory','[]'::jsonb)) is distinct from 'array' then return false; end if;
        if jsonb_array_length(coalesce(v_next->'removalHistory','[]'::jsonb))<jsonb_array_length(v_history) then return false; end if;
        select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_prefix from jsonb_array_elements(coalesce(v_next->'removalHistory','[]'::jsonb)) with ordinality where ordinality<=jsonb_array_length(v_history);
        if v_prefix<>v_history then return false; end if;
        if coalesce(v_previous->'archivedAt','null'::jsonb)<>'null'::jsonb and not(v_next ? 'archivedAt') then return false; end if;
      end if;
    end loop;
  end loop;
  for v_previous in select value from jsonb_array_elements(p_before->'works') loop
    select value into v_next from jsonb_array_elements(p_after->'works') where value->>'id'=v_previous->>'id';
    if v_previous ? 'activity' then
      v_history:=v_previous->'activity';
      if v_next is null then
        if jsonb_array_length(v_history)>0 then return false; end if;
      else
        if not(v_next ? 'activity') or jsonb_typeof(v_next->'activity') is distinct from 'array' then return false; end if;
        if jsonb_array_length(v_next->'activity')<jsonb_array_length(v_history) then return false; end if;
        select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_prefix from jsonb_array_elements(v_next->'activity') with ordinality where ordinality<=jsonb_array_length(v_history);
        if v_prefix<>v_history then return false; end if;
      end if;
    end if;
    for v_field in select unnest(array['startedOn','completedOn','quickActions']) loop
      if v_previous ? v_field and v_previous->v_field<>'null'::jsonb and (v_next is null or not(v_next ? v_field)) then return false; end if;
    end loop;
  end loop;
  for v_previous in select value from jsonb_array_elements(p_before->'people') loop
    select value into v_next from jsonb_array_elements(p_after->'people') where value->>'id'=v_previous->>'id';
    for v_field in select unnest(array['kind','quickActions']) loop
      if v_previous ? v_field and v_previous->v_field<>'null'::jsonb and (v_next is null or not(v_next ? v_field)) then return false; end if;
    end loop;
  end loop;
  for v_previous in select value from jsonb_array_elements(p_before->'contracts') loop
    select value into v_next from jsonb_array_elements(p_after->'contracts') where value->>'id'=v_previous->>'id';
    for v_field in select unnest(array['history','activity']) loop
      v_history:=coalesce(v_previous->v_field,'[]'::jsonb);
      if v_next is null then
        if jsonb_array_length(v_history)>0 then return false; end if;
      else
        if jsonb_typeof(coalesce(v_next->v_field,'[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(v_next->v_field,'[]'::jsonb))<jsonb_array_length(v_history) then return false; end if;
        select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_prefix from jsonb_array_elements(coalesce(v_next->v_field,'[]'::jsonb)) with ordinality where ordinality<=jsonb_array_length(v_history);
        if v_field='activity' then
          select coalesce(jsonb_agg(public.contract_activity_for_comparison(value) order by ordinality),'[]'::jsonb) into v_history from jsonb_array_elements(v_history) with ordinality;
          select coalesce(jsonb_agg(public.contract_activity_for_comparison(value) order by ordinality),'[]'::jsonb) into v_prefix from jsonb_array_elements(v_prefix) with ordinality;
        end if;
        if v_prefix<>v_history then return false; end if;
      end if;
    end loop;
    if v_next is not null and public.contract_terms(v_previous)<>public.contract_terms(v_next) and jsonb_array_length(coalesce(v_next->'activity','[]'::jsonb))<=jsonb_array_length(coalesce(v_previous->'activity','[]'::jsonb)) then return false; end if;
    if v_next is not null and jsonb_array_length(coalesce(v_next->'activity','[]'::jsonb))>jsonb_array_length(coalesce(v_previous->'activity','[]'::jsonb)) and public.contract_terms(v_next->'activity'->jsonb_array_length(coalesce(v_previous->'activity','[]'::jsonb))->'before') is distinct from public.contract_terms(v_previous) then return false; end if;

  end loop;
  return true;
exception when others then return false;
end;
$$;

alter table public.ledger_documents add constraint ledger_removals_valid check (public.ledger_removals_are_valid(document)) not valid;
revoke all on function public.ledger_removals_are_valid(jsonb) from public,anon;
grant execute on function public.ledger_removals_are_valid(jsonb) to authenticated,service_role;
notify pgrst,'reload schema';

commit;

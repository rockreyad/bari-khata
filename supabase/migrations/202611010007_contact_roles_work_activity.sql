create or replace function public.ledger_details_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_person jsonb;
  v_work jsonb;
  v_event jsonb;
  v_snapshot jsonb;
  v_actions jsonb;
  v_field text;
  v_when timestamptz;
  v_groups jsonb := coalesce(p_document->'materialGroups', '[]'::jsonb);
  v_group jsonb;
  v_item jsonb;
  v_entry jsonb;
  v_line jsonb;
  v_source jsonb;
begin
  for v_person in select value from jsonb_array_elements(p_document->'people') loop
    if v_person ? 'kind' and v_person->'kind' <> 'null'::jsonb and (jsonb_typeof(v_person->'kind') is distinct from 'string' or v_person->>'kind' not in ('worker','shop','driver','other')) then return false; end if;
    v_actions := v_person->'quickActions';
    if v_actions is not null and v_actions <> 'null'::jsonb then
      if jsonb_typeof(v_actions) is distinct from 'array' or jsonb_array_length(v_actions)>4 then return false; end if;
      if exists(select 1 from jsonb_array_elements(v_actions) where jsonb_typeof(value) is distinct from 'string' or value #>> '{}' not in ('payment','purchase','return','transport')) then return false; end if;
      if (select count(*) <> count(distinct value) from jsonb_array_elements(v_actions)) then return false; end if;
    end if;
  end loop;
  for v_work in select value from jsonb_array_elements(p_document->'works') loop
    if jsonb_typeof(coalesce(v_work->'activity','[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(v_work->'activity','[]'::jsonb))>2000 then return false; end if;
    if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(coalesce(v_work->'activity','[]'::jsonb))) then return false; end if;
    for v_event in select value from jsonb_array_elements(coalesce(v_work->'activity','[]'::jsonb)) loop
      if jsonb_typeof(v_event->'id') is distinct from 'string' or coalesce(length(v_event->>'id'),0) not between 1 and 160 or jsonb_typeof(v_event->'at') is distinct from 'string' or jsonb_typeof(v_event->'after') is distinct from 'object' then return false; end if;
      if v_event ? 'before' and v_event->'before' <> 'null'::jsonb and jsonb_typeof(v_event->'before') is distinct from 'object' then return false; end if;
      if v_event->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then return false; end if;
      v_when := (v_event->>'at')::timestamptz;
    end loop;
    for v_snapshot in
      select v_work union all
      select event->'after' from jsonb_array_elements(coalesce(v_work->'activity','[]'::jsonb)) as event union all
      select event->'before' from jsonb_array_elements(coalesce(v_work->'activity','[]'::jsonb)) as event where event->'before' is not null and event->'before'<>'null'::jsonb
    loop
      if jsonb_typeof(v_snapshot->'name') is distinct from 'string' or coalesce(length(v_snapshot->>'name'),0) not between 1 and 200 or coalesce(v_snapshot->>'status','ongoing') not in ('planned','ongoing','done') then return false; end if;
      for v_field in select unnest(array['startedOn','completedOn']) loop
        if v_snapshot ? v_field and v_snapshot->v_field <> 'null'::jsonb then
          if jsonb_typeof(v_snapshot->v_field) is distinct from 'string' or v_snapshot->>v_field !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
          if to_char(to_date(v_snapshot->>v_field,'YYYY-MM-DD'),'YYYY-MM-DD') <> v_snapshot->>v_field then return false; end if;
        end if;
      end loop;
      if v_snapshot->>'startedOn' is not null and v_snapshot->>'completedOn' is not null and v_snapshot->>'completedOn' < v_snapshot->>'startedOn' then return false; end if;
      v_actions := v_snapshot->'quickActions';
      if v_actions is not null and v_actions <> 'null'::jsonb then
        if jsonb_typeof(v_actions) is distinct from 'array' or jsonb_array_length(v_actions)>4 then return false; end if;
        if exists(select 1 from jsonb_array_elements(v_actions) where jsonb_typeof(value) is distinct from 'string' or value #>> '{}' not in ('expense','payment','labour','transport')) then return false; end if;
        if (select count(*) <> count(distinct value) from jsonb_array_elements(v_actions)) then return false; end if;
      end if;
    end loop;
  end loop;
  if jsonb_typeof(v_groups) is distinct from 'array' then return false; end if;
  if (select count(*) <> count(distinct value->>'id') from jsonb_array_elements(v_groups)) then return false; end if;
  for v_group in select value from jsonb_array_elements(v_groups) loop
    if jsonb_typeof(v_group->'id') is distinct from 'string'
       or coalesce(length(v_group->>'id'), 0) not between 1 and 160
       or jsonb_typeof(v_group->'name') is distinct from 'string'
       or coalesce(length(v_group->>'name'), 0) not between 1 and 200
       or jsonb_typeof(coalesce(v_group->'aliases', '[]'::jsonb)) is distinct from 'array'
       or exists(select 1 from jsonb_array_elements(coalesce(v_group->'aliases', '[]'::jsonb)) where jsonb_typeof(value) is distinct from 'string') then return false; end if;
  end loop;
  for v_item in select value from jsonb_array_elements(p_document->'items') loop
    if v_item->>'materialGroupId' is not null and jsonb_typeof(v_item->'materialGroupId') is distinct from 'string' then return false; end if;
    if v_item->>'materialGroupId' is not null and not exists(select 1 from jsonb_array_elements(v_groups) where value->>'id' = v_item->>'materialGroupId') then return false; end if;
    if (v_item ? 'brand' and jsonb_typeof(v_item->'brand') is distinct from 'string') or (v_item ? 'usage' and jsonb_typeof(v_item->'usage') is distinct from 'string') then return false; end if;
  end loop;
  for v_entry in
    select value from jsonb_array_elements(p_document->'entries')
    union all
    select revision->'before' from jsonb_array_elements(p_document->'entries') as entry,
      lateral jsonb_array_elements(coalesce(entry->'revisions', '[]'::jsonb)) as revision
  loop
    if v_entry ? 'balanceImpact' and coalesce(v_entry->>'balanceImpact', '') not in ('normal', 'historical') then return false; end if;
    if v_entry ? 'reviewStatus' and coalesce(v_entry->>'reviewStatus', '') not in ('confirmed', 'needs_review') then return false; end if;
    if v_entry ? 'reviewReason' and jsonb_typeof(v_entry->'reviewReason') is distinct from 'string' then return false; end if;
    v_source := v_entry->'source';
    if v_source is not null and v_source <> 'null'::jsonb then
      if jsonb_typeof(v_source) is distinct from 'object'
         or jsonb_typeof(v_source->'file') is distinct from 'string'
         or coalesce(length(v_source->>'file'), 0) = 0
         or jsonb_typeof(v_source->'cell') is distinct from 'string'
         or jsonb_typeof(v_source->'checksum') is distinct from 'string'
         or coalesce(length(v_source->>'checksum'), 0) = 0 then return false; end if;
      if exists(select 1 from unnest(array['sheet', 'note', 'ledger']) as field where v_source ? field and jsonb_typeof(v_source->field) is distinct from 'string') then return false; end if;
    end if;
    for v_line in select value from jsonb_array_elements(coalesce(v_entry->'lines', '[]'::jsonb)) loop
      if v_line->>'materialGroupId' is not null and jsonb_typeof(v_line->'materialGroupId') is distinct from 'string' then return false; end if;
      if v_line->>'materialGroupId' is not null and not exists(select 1 from jsonb_array_elements(v_groups) where value->>'id' = v_line->>'materialGroupId') then return false; end if;
      if v_line ? 'usage' and jsonb_typeof(v_line->'usage') is distinct from 'string' then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;


create function public.ledger_evolution_is_valid(p_before jsonb, p_after jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
  v_previous jsonb;
  v_next jsonb;
  v_history jsonb;
  v_prefix jsonb;
  v_field text;
begin
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
  return true;
exception when others then return false;
end;
$$;

create function public.preserve_ledger_activity()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if not public.ledger_evolution_is_valid(old.document,new.document) then
    raise exception 'ledger_history_would_be_lost';
  end if;
  return new;
end;
$$;

create trigger ledger_preserve_activity before update of document on public.ledger_documents
for each row execute function public.preserve_ledger_activity();
revoke all on function public.ledger_evolution_is_valid(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.preserve_ledger_activity() from public,anon,authenticated;

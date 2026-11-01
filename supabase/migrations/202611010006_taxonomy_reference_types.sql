create or replace function public.ledger_details_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_groups jsonb := coalesce(p_document->'materialGroups', '[]'::jsonb);
  v_group jsonb;
  v_item jsonb;
  v_entry jsonb;
  v_line jsonb;
  v_source jsonb;
begin
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


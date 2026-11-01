create function public.ledger_document_is_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_group text;
  v_entry jsonb;
  v_line jsonb;
  v_contract jsonb;
  v_receipt jsonb;
  v_money jsonb;
  v_amount numeric;
  v_cost numeric;
  v_paid numeric;
  v_allocated numeric;
begin
  if jsonb_typeof(p_document) <> 'object' or p_document->'schemaVersion' <> '1'::jsonb
     or p_document->'isDemo' <> 'false'::jsonb or octet_length(p_document::text) > 10485760
     or jsonb_typeof(p_document->'project') <> 'object'
     or jsonb_typeof(p_document#>'{project,id}') <> 'string'
     or jsonb_typeof(p_document#>'{project,name}') <> 'string'
     or p_document#>>'{project,currency}' <> 'BDT'
     or coalesce(length(p_document#>>'{project,id}'), 0) not between 1 and 160
     or coalesce(length(p_document#>>'{project,name}'), 0) not between 1 and 200 then return false; end if;
  if not (p_document ?& array['schemaVersion','isDemo','project','works','people','items','contracts','entries']) then return false; end if;

  foreach v_group in array array['works','people','items','contracts','entries'] loop
    if jsonb_typeof(p_document->v_group) <> 'array'
       or jsonb_array_length(p_document->v_group) > (case when v_group = 'entries' then 100000 else 10000 end)
       or exists(select 1 from jsonb_array_elements(p_document->v_group) as item
         where jsonb_typeof(item) <> 'object' or jsonb_typeof(item->'id') <> 'string'
           or coalesce(length(item->>'id'), 0) not between 1 and 160)
       or (select count(*) <> count(distinct item->>'id') from jsonb_array_elements(p_document->v_group) as item)
       then return false; end if;
    if v_group in ('works','people','items') and exists(
      select 1 from jsonb_array_elements(p_document->v_group) as item
      where jsonb_typeof(item->'name') <> 'string' or coalesce(length(item->>'name'), 0) not between 1 and 200
    ) then return false; end if;
  end loop;

  for v_money in select value from jsonb_path_query(p_document, '$.**.amount') as value
    union all select value from jsonb_path_query(p_document, '$.**.rate') as value
    union all select value from jsonb_path_query(p_document, '$.**.total') as value loop
    if jsonb_typeof(v_money) <> 'number' then return false; end if;
    v_amount := (v_money #>> '{}')::numeric;
    if v_amount < 0 or v_amount > 9007199254740991 or trunc(v_amount) <> v_amount then return false; end if;
  end loop;

  for v_contract in select value from jsonb_array_elements(p_document->'contracts') loop
    if not exists(select 1 from jsonb_array_elements(p_document->'works') as work where work->>'id' = v_contract->>'workId')
       or not exists(select 1 from jsonb_array_elements(p_document->'people') as person where person->>'id' = v_contract->>'personId')
       or coalesce((v_contract->>'total')::numeric, 0) <= 0 then return false; end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(p_document->'entries') loop
    if coalesce(v_entry->>'kind', '') not in ('expense','payment','expense_credit','refund')
       or coalesce(v_entry->>'account', '') not in ('materials','labour','other')
       or jsonb_typeof(v_entry->'lines') <> 'array' or not (v_entry ? 'lines')
       or jsonb_typeof(v_entry->'allocations') <> 'array' or not (v_entry ? 'allocations')
       or jsonb_typeof(v_entry->'paymentParts') <> 'array' or not (v_entry ? 'paymentParts')
       or jsonb_typeof(v_entry->'receipts') <> 'array' or not (v_entry ? 'receipts')
       or jsonb_array_length(v_entry->'lines') > 1000 or jsonb_array_length(v_entry->'allocations') > 1000
       or jsonb_array_length(v_entry->'paymentParts') > 100 or jsonb_array_length(v_entry->'receipts') > 30
       then return false; end if;
    if v_entry->>'personId' is not null and not exists(select 1 from jsonb_array_elements(p_document->'people') as person where person->>'id' = v_entry->>'personId') then return false; end if;
    if v_entry->>'contractId' is not null and not exists(select 1 from jsonb_array_elements(p_document->'contracts') as contract where contract->>'id' = v_entry->>'contractId') then return false; end if;
    if v_entry->>'relatedEntryId' is not null and not exists(select 1 from jsonb_array_elements(p_document->'entries') as entry where entry->>'id' = v_entry->>'relatedEntryId') then return false; end if;
    if v_entry->>'date' is not null and (v_entry->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
      or to_char(to_date(v_entry->>'date', 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_entry->>'date') then return false; end if;

    v_cost := 0;
    for v_line in select value from jsonb_array_elements(v_entry->'lines') loop
      if coalesce((v_line->>'amount')::numeric, 0) <= 0
         or not exists(select 1 from jsonb_array_elements(p_document->'works') as work where work->>'id' = v_line->>'workId')
         or coalesce(v_line->>'costType', '') not in ('material','labour','transport','unload','rental','other')
         or (v_entry->>'account' = 'labour') <> (v_line->>'costType' = 'labour') then return false; end if;
      if v_line->>'itemId' is not null and not exists(select 1 from jsonb_array_elements(p_document->'items') as item where item->>'id' = v_line->>'itemId') then return false; end if;
      v_cost := v_cost + (v_line->>'amount')::numeric;
    end loop;
    v_paid := 0;
    for v_line in select value from jsonb_array_elements(v_entry->'paymentParts') loop
      if coalesce((v_line->>'amount')::numeric, 0) <= 0
         or coalesce(v_line->>'method', '') not in ('cash','bkash','bank','other') then return false; end if;
      v_paid := v_paid + (v_line->>'amount')::numeric;
    end loop;
    v_allocated := 0;
    for v_line in select value from jsonb_array_elements(v_entry->'allocations') loop
      if coalesce((v_line->>'amount')::numeric, 0) <= 0
         or not exists(select 1 from jsonb_array_elements(p_document->'works') as work where work->>'id' = v_line->>'workId') then return false; end if;
      v_allocated := v_allocated + (v_line->>'amount')::numeric;
    end loop;
    if greatest(v_cost, v_paid, v_allocated) > 9007199254740991 then return false; end if;
    if v_entry->>'kind' in ('expense','expense_credit') then
      if v_cost <= 0 or v_paid <> 0 or v_allocated <> 0 then return false; end if;
    elsif v_paid <= 0 or v_paid <> v_allocated or v_cost <> 0 then return false;
    end if;

    for v_receipt in select value from jsonb_array_elements(v_entry->'receipts') loop
      if coalesce(length(v_receipt->>'id'), 0) not between 1 and 160
         or coalesce(length(v_receipt->>'name'), 0) not between 1 and 300
         or coalesce(v_receipt->>'mime', '') not in ('image/jpeg','image/png','image/webp','application/pdf')
         or coalesce((v_receipt->>'size')::numeric, -1) not between 0 and 10485760 then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.ledger_documents add constraint ledger_document_valid
  check (public.ledger_document_is_valid(document));

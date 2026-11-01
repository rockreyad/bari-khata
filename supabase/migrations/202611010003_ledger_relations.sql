create function public.ledger_relations_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare
  v_entry jsonb;
  v_contract jsonb;
  v_original jsonb;
  v_money numeric := 0;
  v_contracts numeric;
begin
  if not public.ledger_document_is_valid(p_document) then return false; end if;
  select coalesce(sum((value->>'total')::numeric), 0) into v_contracts
    from jsonb_array_elements(p_document->'contracts');
  if v_contracts > 9007199254740991 then return false; end if;
  if (select count(*) <> count(distinct receipt->>'id')
      from jsonb_array_elements(p_document->'entries') as entry,
      lateral jsonb_array_elements(entry->'receipts') as receipt) then return false; end if;

  for v_entry in select value from jsonb_array_elements(p_document->'entries') loop
    if (v_entry ? 'voided') and jsonb_typeof(v_entry->'voided') is distinct from 'boolean' then return false; end if;
    if exists(select 1 from jsonb_array_elements(v_entry->'lines') as line
      where jsonb_typeof(line->'id') is distinct from 'string'
        or coalesce(length(line->>'id'), 0) not between 1 and 160)
      or (select count(*) <> count(distinct line->>'id') from jsonb_array_elements(v_entry->'lines') as line)
      then return false; end if;
    if v_entry->>'contractId' is not null then
      select value into v_contract from jsonb_array_elements(p_document->'contracts')
        where value->>'id' = v_entry->>'contractId';
      if v_entry->>'account' is distinct from 'labour'
         or v_entry->>'personId' is distinct from v_contract->>'personId'
         or exists(select 1 from jsonb_array_elements((v_entry->'lines') || (v_entry->'allocations')) as part
           where part->>'workId' is distinct from v_contract->>'workId') then return false; end if;
    end if;
    if v_entry->>'relatedEntryId' is not null then
      select value into v_original from jsonb_array_elements(p_document->'entries')
        where value->>'id' = v_entry->>'relatedEntryId';
      if v_original->>'kind' is distinct from 'expense' or v_original->>'id' = v_entry->>'id'
         or v_entry->>'kind' = 'expense'
         or v_entry->>'personId' is distinct from v_original->>'personId'
         or v_entry->>'account' is distinct from v_original->>'account'
         or v_entry->>'contractId' is distinct from v_original->>'contractId'
         or exists(select 1 from jsonb_array_elements((v_entry->'lines') || (v_entry->'allocations')) as part
           where not exists(select 1 from jsonb_array_elements(v_original->'lines') as original_line
             where original_line->>'workId' = part->>'workId')) then return false; end if;
    end if;
    if coalesce((v_entry->>'voided')::boolean, false) = false then
      select v_money + coalesce(sum((part->>'amount')::numeric), 0) into v_money
        from jsonb_array_elements((v_entry->'lines') || (v_entry->'paymentParts')) as part;
      if v_money > 9007199254740991 then return false; end if;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table public.ledger_documents add constraint ledger_relations_valid
  check (public.ledger_relations_are_valid(document));

begin;

create function public.adjustment_snapshot_is_valid(p_entry jsonb,p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_adjustment jsonb; v_field text; v_amount numeric; v_contract jsonb; v_time timestamptz;
begin
  if p_entry->>'kind' is distinct from 'adjustment' then
    return coalesce(p_entry->'adjustment','null'::jsonb)='null'::jsonb;
  end if;
  v_adjustment:=p_entry->'adjustment';
  if jsonb_typeof(v_adjustment) is distinct from 'object'
    or not(v_adjustment ?& array['target','basis','account','delta','before','after','workId'])
    or exists(select 1 from jsonb_object_keys(v_adjustment) k where k not in ('target','basis','account','delta','before','after','workId'))
    or coalesce(v_adjustment->>'target','') not in ('person','work')
    or coalesce(v_adjustment->>'basis','') not in ('paid','cost','balance')
    or coalesce(p_entry->>'account','') not in ('materials','labour','other')
    or jsonb_typeof(p_entry->'note') is distinct from 'string'
    or length(btrim(p_entry->>'note')) not between 1 and 10000
    or coalesce(p_entry->'balanceImpact','"normal"'::jsonb)<>'"normal"'::jsonb
    or coalesce(p_entry->'reviewStatus','"confirmed"'::jsonb)<>'"confirmed"'::jsonb
    or coalesce(p_entry->'relatedEntryId','null'::jsonb)<>'null'::jsonb
    or coalesce(p_entry->'paymentPurposeId','null'::jsonb)<>'null'::jsonb then return false; end if;
  if v_adjustment->>'target'='person' then
    if jsonb_typeof(p_entry->'personId') is distinct from 'string'
      or not exists(select 1 from jsonb_array_elements(p_document->'people') p where p->>'id'=p_entry->>'personId')
      or v_adjustment->'account' is distinct from p_entry->'account' then return false; end if;
  elsif coalesce(p_entry->'personId','null'::jsonb)<>'null'::jsonb
    or v_adjustment->'account'<>'null'::jsonb or p_entry->>'account'<>'other'
    or v_adjustment->'workId'='null'::jsonb
    or coalesce(p_entry->'contractId','null'::jsonb)<>'null'::jsonb then return false; end if;
  if p_entry ? 'voided' and jsonb_typeof(p_entry->'voided') is distinct from 'boolean' then return false; end if;
  foreach v_field in array array['createdAt','updatedAt'] loop
    if p_entry ? v_field then
      if jsonb_typeof(p_entry->v_field) is distinct from 'string' then return false; end if;
      if p_entry->>v_field<>'' then
        if p_entry->>v_field !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$' then return false; end if;
        v_time:=(p_entry->>v_field)::timestamptz;
      end if;
    end if;
  end loop;
  foreach v_field in array array['lines','paymentParts','allocations','receipts'] loop
    if coalesce(p_entry->v_field,'[]'::jsonb)<>'[]'::jsonb then return false; end if;
  end loop;
  foreach v_field in array array['delta','before','after'] loop
    if jsonb_typeof(v_adjustment->v_field) is distinct from 'number' then return false; end if;
    v_amount:=(v_adjustment->>v_field)::numeric;
    if abs(v_amount)>9007199254740991 or trunc(v_amount)<>v_amount then return false; end if;
  end loop;
  if (v_adjustment->>'delta')::numeric=0 or
    (v_adjustment->>'after')::numeric-(v_adjustment->>'before')::numeric<>(v_adjustment->>'delta')::numeric then return false; end if;
  if v_adjustment->'workId'<>'null'::jsonb and (
    jsonb_typeof(v_adjustment->'workId') is distinct from 'string' or
    not exists(select 1 from jsonb_array_elements(p_document->'works') w where w->>'id'=v_adjustment->>'workId')
  ) then return false; end if;
  if p_entry->>'contractId' is not null then
    if jsonb_typeof(p_entry->'contractId') is distinct from 'string' then return false; end if;
    select c into v_contract from jsonb_array_elements(p_document->'contracts') c where c->>'id'=p_entry->>'contractId';
    if v_contract is null or p_entry->>'account'<>'labour' or p_entry->>'personId' is distinct from v_contract->>'personId' then return false; end if;
    if coalesce(v_contract->>'scope','work')='house' then
      if v_adjustment->'workId'<>'null'::jsonb then return false; end if;
    elsif v_adjustment->>'workId' is distinct from v_contract->>'workId' then return false; end if;
  end if;
  return true;
exception when others then return false;
end;
$$;

create function public.adjustment_immutable_core(p_entry jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object(
    'id',p_entry->'id','kind',p_entry->'kind','adjustment',p_entry->'adjustment',
    'personId',p_entry->>'personId','account',coalesce(p_entry->>'account','materials'),
    'note',coalesce(p_entry->>'note',''),'date',p_entry->>'date',
    'contractId',p_entry->>'contractId','relatedEntryId',p_entry->>'relatedEntryId',
    'paymentPurposeId',p_entry->>'paymentPurposeId',
    'balanceImpact',coalesce(p_entry->>'balanceImpact','normal'),
    'reviewStatus',coalesce(p_entry->>'reviewStatus','confirmed'),
    'reviewReason',coalesce(p_entry->>'reviewReason',''),
    'source',coalesce(p_entry->'source','null'::jsonb),
    'provenance',coalesce(p_entry->'provenance','null'::jsonb),
    'lines',coalesce(p_entry->'lines','[]'::jsonb),
    'paymentParts',coalesce(p_entry->'paymentParts','[]'::jsonb),
    'allocations',coalesce(p_entry->'allocations','[]'::jsonb),
    'receipts',coalesce(p_entry->'receipts','[]'::jsonb),
    'createdAt',coalesce(p_entry->>'createdAt','')
  );
$$;

create function public.adjustment_entry_core(p_entry jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
  select public.adjustment_immutable_core(p_entry) || jsonb_build_object(
    'updatedAt',coalesce(p_entry->>'updatedAt',''),
    'voided',coalesce((p_entry->>'voided')::boolean,false)
  );
$$;

create function public.ledger_adjustments_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_entry jsonb; v_revision jsonb; v_before jsonb; v_after jsonb; v_history jsonb; v_index integer; v_previous timestamptz; v_at timestamptz;
begin
  for v_entry in select e from jsonb_array_elements(p_document->'entries') e loop
    v_history:=coalesce(v_entry->'revisions','[]'::jsonb);
    if jsonb_typeof(v_history) is distinct from 'array' or jsonb_array_length(v_history)>2000 then return false; end if;
    if not public.adjustment_snapshot_is_valid(v_entry,p_document) then return false; end if;
    for v_revision in select r from jsonb_array_elements(v_history) r loop
      if not public.adjustment_snapshot_is_valid(v_revision->'before',p_document) then return false; end if;
      if v_revision#>>'{before,kind}'='adjustment' and v_entry->>'kind'<>'adjustment' then return false; end if;
    end loop;
    if v_entry->>'kind'<>'adjustment' then continue; end if;
    if coalesce(((case when jsonb_array_length(v_history)>0 then v_history#>'{0,before}' else v_entry end)->>'voided')::boolean,false) then return false; end if;
    v_index:=0; v_previous:=null;
    for v_revision in select r from jsonb_array_elements(v_history) r loop
      v_before:=v_revision->'before';
      v_after:=case when v_index+1<jsonb_array_length(v_history) then v_history#>array[(v_index+1)::text,'before'] else v_entry end;
      if jsonb_typeof(v_revision) is distinct from 'object' or jsonb_typeof(v_before) is distinct from 'object'
        or v_before->>'kind' is distinct from 'adjustment'
        or (public.adjustment_immutable_core(v_before)-'provenance') is distinct from (public.adjustment_immutable_core(v_entry)-'provenance')
        or coalesce((v_before->>'voided')::boolean,false)=coalesce((v_after->>'voided')::boolean,false)
        or jsonb_typeof(v_revision->'at') is distinct from 'string'
        or v_revision->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$'
        or v_after->>'updatedAt' is distinct from v_revision->>'at' then return false; end if;
      v_at:=(v_revision->>'at')::timestamptz;
      if v_previous is not null and v_at<v_previous then return false; end if;
      v_previous:=v_at; v_index:=v_index+1;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function public.balance_adjustments_are_preserved(p_before jsonb,p_after jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_old jsonb; v_new jsonb; v_history jsonb; v_prefix jsonb;
begin
  if not public.ledger_adjustments_are_valid(p_after) then return false; end if;
  for v_new in select e from jsonb_array_elements(p_after->'entries') e where e->>'kind'='adjustment' loop
    if exists(select 1 from jsonb_array_elements(p_before->'entries') e where e->>'id'=v_new->>'id' and e->>'kind'<>'adjustment') then return false; end if;
  end loop;
  for v_old in select e from jsonb_array_elements(p_before->'entries') e where e->>'kind'='adjustment' loop
    select e into v_new from jsonb_array_elements(p_after->'entries') e where e->>'id'=v_old->>'id';
    if v_new is null or (public.adjustment_immutable_core(v_old)-'provenance') is distinct from (public.adjustment_immutable_core(v_new)-'provenance') then return false; end if;
    v_history:=coalesce(v_old->'revisions','[]'::jsonb);
    select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_prefix
      from jsonb_array_elements(coalesce(v_new->'revisions','[]'::jsonb)) with ordinality where ordinality<=jsonb_array_length(v_history);
    if v_prefix is distinct from v_history then return false; end if;
    if jsonb_array_length(coalesce(v_new->'revisions','[]'::jsonb))=jsonb_array_length(v_history) then
      if public.adjustment_entry_core(v_old) is distinct from public.adjustment_entry_core(v_new) then return false; end if;
    elsif public.adjustment_entry_core(v_new#>array['revisions',jsonb_array_length(v_history)::text,'before']) is distinct from public.adjustment_entry_core(v_old) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function public.preserve_balance_adjustments()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin
  if not public.balance_adjustments_are_preserved(old.document,new.document) then
    raise exception 'balance_adjustment_would_be_lost';
  end if;
  return new;
end;
$$;

alter table public.ledger_documents add constraint ledger_adjustments_valid check(public.ledger_adjustments_are_valid(document)) not valid;
create trigger ledger_preserve_balance_adjustments before update of document on public.ledger_documents
for each row execute function public.preserve_balance_adjustments();


create or replace function public.ledger_document_is_valid(p_document jsonb)
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
    if ((coalesce(v_contract->>'scope','work') = 'work' or v_contract->>'workId' is not null) and not exists(select 1 from jsonb_array_elements(p_document->'works') as work where work->>'id' = v_contract->>'workId'))
       or not exists(select 1 from jsonb_array_elements(p_document->'people') as person where person->>'id' = v_contract->>'personId')
       or coalesce((v_contract->>'total')::numeric, 0) <= 0 then return false; end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(p_document->'entries') loop
    if coalesce(v_entry->>'kind', '') not in ('expense','payment','expense_credit','refund','adjustment')
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

    if not public.adjustment_snapshot_is_valid(v_entry,p_document) then return false; end if;
    if v_entry->>'kind'='adjustment' then continue; end if;

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

create or replace function public.ledger_relations_are_valid(p_document jsonb)
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
         or (coalesce(v_contract->>'scope','work') = 'work' and exists(select 1 from jsonb_array_elements((v_entry->'lines') || (v_entry->'allocations')) as part
           where part->>'workId' is distinct from v_contract->>'workId')) then return false; end if;
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
      v_money := v_money + case when v_entry->>'kind'='adjustment' then abs((v_entry#>>'{adjustment,delta}')::numeric) else 0 end;
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



create or replace function private.mcp_document_changes(p_before jsonb,p_after jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_scopes text[]:=array['ledger:read']; v_ids text[]:='{}'; v_entry jsonb; v_old jsonb; v_key text; v_amount numeric:=0; v_new_amount numeric; v_old_amount numeric;
begin
  if p_before is not null and p_before->'project' is distinct from p_after->'project' then raise exception 'mcp_forbidden'; end if;
  foreach v_key in array array['works','people','contracts','items','materialGroups','paymentPurposes'] loop
    if private.mcp_comparable(coalesce(p_before->v_key,'[]'::jsonb),v_key) is distinct from private.mcp_comparable(coalesce(p_after->v_key,'[]'::jsonb),v_key) then
      v_scopes:=array_append(v_scopes,case when v_key in ('works','people') then 'entities:write' when v_key='contracts' then 'contracts:write' else 'catalog:write' end);
    end if;
  end loop;
  for v_entry in select value from jsonb_array_elements(coalesce(p_after->'contracts','[]'::jsonb)) loop
    select value into v_old from jsonb_array_elements(coalesce(p_before->'contracts','[]'::jsonb)) old where old->>'id'=v_entry->>'id';
    if v_old is null or v_old->'total' is distinct from v_entry->'total' then v_amount:=greatest(v_amount,(v_entry->>'total')::numeric); end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(coalesce(p_before->'entries','[]'::jsonb)) old where not exists(select 1 from jsonb_array_elements(p_after->'entries') n where n->>'id'=old->>'id')) then raise exception 'mcp_forbidden'; end if;
  for v_entry in select value from jsonb_array_elements(p_after->'entries') loop
    select value into v_old from jsonb_array_elements(coalesce(p_before->'entries','[]'::jsonb)) old where old->>'id'=v_entry->>'id';
    if private.mcp_comparable(v_old,'entries') is not distinct from private.mcp_comparable(v_entry,'entries') then continue; end if;
    v_ids:=array_append(v_ids,v_entry->>'id');
    if v_old is null then v_scopes:=array_append(v_scopes,'entries:create');
    elsif private.mcp_comparable(v_old-array['voided','updatedAt','revisions','provenance'],'entries')=private.mcp_comparable(v_entry-array['voided','updatedAt','revisions','provenance'],'entries') and coalesce(v_old->'voided','false'::jsonb) is distinct from coalesce(v_entry->'voided','false'::jsonb) then
      v_scopes:=array_append(v_scopes,'entries:void_restore');
    else v_scopes:=array_append(v_scopes,'entries:update'); end if;
    select coalesce(sum((x->>'amount')::numeric),0) + case when v_entry->>'kind'='adjustment' then abs((v_entry#>>'{adjustment,delta}')::numeric) else 0 end into v_new_amount from jsonb_array_elements(coalesce(v_entry->'lines','[]'::jsonb)||coalesce(v_entry->'paymentParts','[]'::jsonb)) x;
    select coalesce(sum((x->>'amount')::numeric),0) + case when v_old->>'kind'='adjustment' then abs((v_old#>>'{adjustment,delta}')::numeric) else 0 end into v_old_amount from jsonb_array_elements(coalesce(v_old->'lines','[]'::jsonb)||coalesce(v_old->'paymentParts','[]'::jsonb)) x;
    if v_old is null or private.mcp_comparable(v_old-array['receipts','updatedAt','revisions','provenance'],'entries') is distinct from private.mcp_comparable(v_entry-array['receipts','updatedAt','revisions','provenance'],'entries') then
      v_amount:=greatest(v_amount,v_new_amount,v_old_amount);
    end if;
    if coalesce(v_entry->'receipts','[]'::jsonb) is distinct from coalesce(v_old->'receipts','[]'::jsonb) then
      v_scopes:=array_append(v_scopes,'receipts:write');
    end if;
  end loop;
  select array_agg(distinct s order by s) into v_scopes from unnest(v_scopes) s;
  if v_amount>9007199254740991 or v_amount<0 or trunc(v_amount)<>v_amount then raise exception 'mcp_invalid_document'; end if;
  return jsonb_build_object('requiredScopes',to_jsonb(v_scopes),'amountPaisa',v_amount,'entryIds',to_jsonb(v_ids));
end;
$$;

create or replace function public.read_contact_share(p_token text, p_offset integer default 0, p_limit integer default 40, p_revision bigint default null, p_kind text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.contact_share_links; v_doc jsonb; v_person jsonb; v_revision bigint;
  v_updated timestamptz; v_result jsonb; v_driver boolean; v_contracts jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 or p_limit is null or p_limit < 1 or p_limit > 60 then
    raise exception 'invalid_share_page';
  end if;
  if p_kind is not null and p_kind not in ('expense','payment','expense_credit','refund','adjustment') then raise exception 'invalid_share_filter'; end if;
  select * into v_link from public.contact_share_links
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and revoked_at is null;
  if not found then return null; end if;
  select document, revision, updated_at into v_doc, v_revision, v_updated
    from public.ledger_documents where owner_id = v_link.owner_id;
  select p into v_person from jsonb_array_elements(v_doc->'people') p where p->>'id' = v_link.person_id;
  if v_person is null then return null; end if;
  if p_revision is not null and p_revision <> v_revision then raise exception 'share_changed'; end if;
  v_driver := coalesce(v_person->>'kind', case
    when concat(v_person->>'role',' ',v_person->>'name') ~* 'দোকান|স্টোর|হার্ডওয়্যার|ট্রেড|সাপ্লাই|এন্টারপ্রাইজ|shop|store|trading|enterprise|supplier|hardware' then 'shop'
    when concat(v_person->>'role',' ',v_person->>'name') ~* 'চালক|ড্রাইভার|ভ্যান|driver|transport|truck|van' then 'driver'
    else 'other' end) = 'driver';
  v_contracts := '[]'::jsonb;
  if v_link.account = 'labour' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'title', coalesce(c->>'title',''), 'workName', coalesce(w->>'name',''),
      'total', (c->>'total')::numeric, 'netPaid', paid,
      'remaining', greatest(greatest((c->>'total')::numeric,billed) + adjusted - paid, 0)
    ) order by c->>'id'), '[]'::jsonb) into v_contracts
    from jsonb_array_elements(v_doc->'contracts') c
    left join lateral (
      select w from jsonb_array_elements(v_doc->'works') w where w->>'id' = c->>'workId'
    ) n on true
    cross join lateral (
      select coalesce(sum((a->>'amount')::numeric * case when e->>'kind' = 'refund' then -1 else 1 end),0) paid
      from jsonb_array_elements(v_doc->'entries') e
      cross join lateral jsonb_array_elements(e->'allocations') a
      where e->>'personId' = v_link.person_id and e->>'account' = 'labour'
        and e->>'contractId' = c->>'id' and (coalesce(c->>'scope','work')='house' or a->>'workId' = c->>'workId')
        and e->>'kind' in ('payment','refund')
        and not coalesce((e->>'voided')::boolean, false)
        and coalesce(e->>'balanceImpact','normal') <> 'historical'
    ) payments
    cross join lateral (
      select coalesce(sum((l->>'amount')::numeric * case when e->>'kind'='expense_credit' then -1 else 1 end),0) billed
      from jsonb_array_elements(v_doc->'entries') e cross join lateral jsonb_array_elements(e->'lines') l
      where e->>'contractId'=c->>'id' and e->>'kind' in ('expense','expense_credit')
        and not coalesce((e->>'voided')::boolean,false) and coalesce(e->>'balanceImpact','normal')<>'historical'
    ) bills
    cross join lateral (
      select coalesce(sum((e#>>'{adjustment,delta}')::numeric * case when e#>>'{adjustment,basis}'='paid' then -1 else 1 end),0) adjusted
      from jsonb_array_elements(v_doc->'entries') e
      where e->>'kind'='adjustment' and e->>'contractId'=c->>'id'
        and not coalesce((e->>'voided')::boolean,false)
    ) adjustments
    where c->>'personId' = v_link.person_id and (v_link.work_id is null or (coalesce(c->>'scope','work')='work' and c->>'workId' = v_link.work_id));
  end if;
  with own as (
    select e from jsonb_array_elements(v_doc->'entries') e where e->>'personId' = v_link.person_id
  ), transport_bills as (
    select e->>'id' id from own
    where e->>'kind' in ('expense','expense_credit') and jsonb_array_length(e->'lines') > 0
      and not exists(select 1 from jsonb_array_elements(e->'lines') l where l->>'costType' <> 'transport')
  ), buckets as (
    select e->>'account' account, l->>'workId' work_id, bool_and(l->>'costType' = 'transport') pure
    from own cross join lateral jsonb_array_elements(e->'lines') l
    where e->>'kind' in ('expense','expense_credit') and not coalesce((e->>'voided')::boolean,false)
      and coalesce(e->>'balanceImpact','normal') <> 'historical'
    group by e->>'account', l->>'workId'
  ), classified as (
    select e, case when v_driver and e->>'account' = 'materials' and (
      e->>'id' in (select id from transport_bills) or
      (e->>'kind' in ('payment','refund') and (
        e->>'relatedEntryId' in (select id from transport_bills) or
        (e->>'relatedEntryId' is null and jsonb_array_length(e->'allocations') > 0 and not exists(
          select 1 from jsonb_array_elements(e->'allocations') a where not exists(
            select 1 from buckets b where b.account = e->>'account' and b.work_id = a->>'workId' and b.pure
          )
        ))
      ))
    ) then 'other' else e->>'account' end effective_account from own
  ), scoped as (
    select e, effective_account from classified where not coalesce((e->>'voided')::boolean, false) and (
      (e->>'kind'='adjustment' and effective_account=v_link.account) or
      ((not v_driver or v_link.account <> 'other') and effective_account = v_link.account) or
      (v_driver and v_link.account = 'other' and (
        e->>'id' in (select id from transport_bills) or
        (e->>'kind' in ('payment','refund') and effective_account = 'other' and
          (e->>'relatedEntryId' is null or e->>'relatedEntryId' in (select id from transport_bills)))
      ))
    )
  ), parts as (
    select e, effective_account, part, ord from scoped cross join lateral jsonb_array_elements(
      case when e->>'kind'='adjustment' then jsonb_build_array(jsonb_build_object('workId',e#>'{adjustment,workId}','label',e->>'note'))
        when e->>'kind' in ('expense','expense_credit') then e->'lines' else e->'allocations' end
    ) with ordinality as x(part, ord)
    where v_link.work_id is null or part->>'workId' = v_link.work_id
  ), balances as (
    select effective_account, case when v_link.work_id is null then null else part->>'workId' end work_id, e->>'contractId' contract_id,
      sum(case when e->>'kind' = 'expense' then (part->>'amount')::numeric when e->>'kind' = 'expense_credit' then -(part->>'amount')::numeric else 0 end) cost,
      sum(case when e->>'kind' = 'payment' then (part->>'amount')::numeric when e->>'kind' = 'refund' then -(part->>'amount')::numeric else 0 end) paid,
      sum(case when e->>'kind'='adjustment' then (e#>>'{adjustment,delta}')::numeric * case when e#>>'{adjustment,basis}'='paid' then -1 else 1 end else 0 end) adjustment,
      sum(case when e->>'kind'='adjustment' and e#>>'{adjustment,basis}'='cost' then (e#>>'{adjustment,delta}')::numeric else 0 end) cost_correction,
      sum(case when e->>'kind'='adjustment' and e#>>'{adjustment,basis}'='paid' then (e#>>'{adjustment,delta}')::numeric else 0 end) paid_correction,
      sum(case when e->>'kind'='adjustment' and e#>>'{adjustment,basis}'='balance' then (e#>>'{adjustment,delta}')::numeric else 0 end) balance_correction
    from parts where coalesce(e->>'balanceImpact','normal') <> 'historical'
    group by effective_account, case when v_link.work_id is null then null else part->>'workId' end, e->>'contractId'
  ), jobs as (
    select c job from jsonb_array_elements(v_doc->'contracts') c
    where v_link.account='labour' and c->>'personId'=v_link.person_id
      and (v_link.work_id is null or (coalesce(c->>'scope','work')='work' and c->>'workId'=v_link.work_id))
  ), obligations as (
    select greatest(coalesce(b.cost,0),coalesce((j.job->>'total')::numeric,b.cost,0)) base,
      coalesce(b.paid,0) paid,
      case when b.contract_id is not null then coalesce(b.adjustment,0) else 0 end adjustment
    from balances b full join jobs j on b.contract_id=j.job->>'id'
  ), reconciliation as (
    select coalesce(sum(greatest(base+adjustment-paid,0)),0) due,
      coalesce(sum(greatest(paid-base-adjustment,0)),0) advance,
      coalesce((select sum(adjustment) from balances where contract_id is null),0) pool
    from obligations
  ), rows as (
    select e->>'id' id, e->>'date' date, e->>'createdAt' created, e->>'kind' kind,
      coalesce(e->>'balanceImpact','normal') = 'historical' historical,
      sum(case when e->>'kind' = 'expense' then (part->>'amount')::numeric when e->>'kind' = 'expense_credit' then -(part->>'amount')::numeric else 0 end) charge,
      sum(case when e->>'kind' = 'payment' then (part->>'amount')::numeric when e->>'kind' = 'refund' then -(part->>'amount')::numeric else 0 end) paid,
      sum(case when e->>'kind'='adjustment' then (e#>>'{adjustment,delta}')::numeric else 0 end) adjustment,
      max(e#>>'{adjustment,basis}') adjustment_basis,
      coalesce(string_agg(nullif(part->>'label',''), ' · ' order by ord), '') description,
      coalesce(string_agg(distinct nullif(w->>'name',''), ' · '), '') works
    from parts left join lateral (
      select w from jsonb_array_elements(v_doc->'works') w where w->>'id' = part->>'workId'
    ) n on true
    group by e->>'id', e->>'date', e->>'createdAt', e->>'kind', coalesce(e->>'balanceImpact','normal')
  ), page as (
    select * from rows where p_kind is null or kind = p_kind order by date desc nulls last, created desc, id desc offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'person', jsonb_build_object('name', v_person->>'name', 'role', coalesce(v_person->>'role',''), 'kind', coalesce(v_person->>'kind','other')),
    'projectName', v_doc->'project'->>'name', 'account', v_link.account,
    'workName', coalesce((select w->>'name' from jsonb_array_elements(v_doc->'works') w where w->>'id' = v_link.work_id), ''),
    'updatedAt', v_updated, 'revision', v_revision,
    'total', (select count(*) from rows where p_kind is null or kind = p_kind),
    'counts', jsonb_build_object('expense', (select count(*) from rows where kind = 'expense'), 'payment', (select count(*) from rows where kind = 'payment'), 'expense_credit', (select count(*) from rows where kind = 'expense_credit'), 'refund', (select count(*) from rows where kind = 'refund'), 'adjustment', (select count(*) from rows where kind = 'adjustment')),
    'contracts', v_contracts,
    'nextOffset', case when p_offset + p_limit < (select count(*) from rows where p_kind is null or kind = p_kind) then p_offset + p_limit else null end,
    'totals', jsonb_build_object(
      'cost', coalesce((select sum(charge) from rows),0),
      'paid', coalesce((select sum(paid) from balances),0),
      'adjustment', coalesce((select sum(adjustment) from balances),0),
      'costCorrection', coalesce((select sum(cost_correction) from balances),0),
      'paidCorrection', coalesce((select sum(paid_correction) from balances),0),
      'balanceCorrection', coalesce((select sum(balance_correction) from balances),0),
      'actualCost', coalesce((select sum(charge) from rows),0),
      'actualPaid', coalesce((select sum(paid) from rows where kind='payment' and not historical),0),
      'actualRefunds', -coalesce((select sum(paid) from rows where kind='refund' and not historical),0),
      'actualNetPaid', coalesce((select sum(paid) from balances),0),
      'reconciledCost', coalesce((select sum(charge) from rows),0)+coalesce((select sum(cost_correction) from balances),0),
      'reconciledNetPaid', coalesce((select sum(paid+paid_correction) from balances),0),
      'reconciledBalance', (select due-advance+pool from reconciliation),
      'reconciledPayable', (select greatest(due-advance+pool,0) from reconciliation),
      'reconciledAdvance', (select greatest(advance-due-pool,0) from reconciliation),
      'payable', (select greatest(due-advance+pool,0) from reconciliation),
      'advance', (select greatest(advance-due-pool,0) from reconciliation),
      'historicalCost', coalesce((select sum(charge) from rows where historical),0)
    ),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'key', id, 'date', date, 'kind', kind, 'historical', historical,
      'charge', charge, 'paid', paid, 'adjustment', adjustment, 'adjustmentBasis', adjustment_basis, 'description', description, 'works', works
    ) order by date desc nulls last, created desc, id desc) from page), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;


revoke all on function public.adjustment_snapshot_is_valid(jsonb,jsonb),public.adjustment_immutable_core(jsonb),public.adjustment_entry_core(jsonb),public.ledger_adjustments_are_valid(jsonb),public.balance_adjustments_are_preserved(jsonb,jsonb),public.preserve_balance_adjustments() from public,anon;
grant execute on function public.adjustment_snapshot_is_valid(jsonb,jsonb),public.adjustment_immutable_core(jsonb),public.adjustment_entry_core(jsonb),public.ledger_adjustments_are_valid(jsonb),public.balance_adjustments_are_preserved(jsonb,jsonb) to authenticated,service_role;
revoke all on function public.preserve_balance_adjustments() from authenticated;
notify pgrst,'reload schema';

commit;

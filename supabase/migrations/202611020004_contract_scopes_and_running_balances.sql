begin;

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

create function public.contract_terms(p_contract jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object(
    'scope',coalesce(p_contract->>'scope','work'),'workId',p_contract->>'workId','personId',p_contract->>'personId',
    'title',coalesce(p_contract->>'title',''),'basis',coalesce(p_contract->>'basis','fixed'),
    'quantity',translate(coalesce(p_contract->>'quantity','1'),'০১২৩৪৫৬৭৮৯','0123456789'),
    'rate',coalesce(p_contract->'rate','0'::jsonb),'total',p_contract->'total',
    'notes',coalesce(p_contract->>'notes',''),'agreedOn',p_contract->>'agreedOn'
  );
$$;

create function public.contract_snapshot_is_valid(p_contract jsonb,p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_scope text; v_quantity text; v_date text;
begin
  if jsonb_typeof(p_contract) is distinct from 'object' then return false; end if;
  if p_contract ? 'scope' and jsonb_typeof(p_contract->'scope') is distinct from 'string' then return false; end if;
  v_scope:=coalesce(p_contract->>'scope','work');
  if v_scope not in ('work','house') then return false; end if;
  if v_scope='work' and p_contract->>'workId' is null then return false; end if;
  if p_contract->>'workId' is not null and not exists(select 1 from jsonb_array_elements(p_document->'works') where value->>'id'=p_contract->>'workId') then return false; end if;
  if not exists(select 1 from jsonb_array_elements(p_document->'people') where value->>'id'=p_contract->>'personId') then return false; end if;
  if coalesce(p_contract->>'basis','fixed') not in ('fixed','sqft','day') then return false; end if;
  if jsonb_typeof(p_contract->'total') is distinct from 'number' or coalesce((p_contract->>'total')::numeric,0)<=0 then return false; end if;
  if p_contract ? 'quantity' and jsonb_typeof(p_contract->'quantity') is distinct from 'string' then return false; end if;
  v_quantity:=translate(coalesce(p_contract->>'quantity','1'),'০১২৩৪৫৬৭৮৯','0123456789');
  if length(v_quantity)>60 or v_quantity !~ '^\d+(\.\d{1,4})?$' or v_quantity::numeric<=0 then return false; end if;
  if (p_contract ? 'title' and (jsonb_typeof(p_contract->'title') is distinct from 'string' or length(p_contract->>'title')>300)) or
     (p_contract ? 'notes' and (jsonb_typeof(p_contract->'notes') is distinct from 'string' or length(p_contract->>'notes')>10000)) then return false; end if;
  v_date:=p_contract->>'agreedOn';
  if v_date is not null and (v_date !~ '^\d{4}-\d{2}-\d{2}$' or to_char(to_date(v_date,'YYYY-MM-DD'),'YYYY-MM-DD')<>v_date) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create function public.ledger_contracts_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_contract jsonb; v_activity jsonb; v_previous jsonb; v_history jsonb; v_last timestamptz; v_when timestamptz;
begin
  for v_contract in select value from jsonb_array_elements(p_document->'contracts') loop
    if not public.contract_snapshot_is_valid(v_contract,p_document) then return false; end if;
    if jsonb_typeof(coalesce(v_contract->'history','[]'::jsonb)) is distinct from 'array' or jsonb_typeof(coalesce(v_contract->'activity','[]'::jsonb)) is distinct from 'array' then return false; end if;
    if jsonb_array_length(coalesce(v_contract->'activity','[]'::jsonb))>2000 then return false; end if;
    for v_history in select value from jsonb_array_elements(coalesce(v_contract->'history','[]'::jsonb)) loop
      if jsonb_typeof(v_history) is distinct from 'object' or jsonb_typeof(v_history->'at') is distinct from 'string' or jsonb_typeof(v_history->'total') is distinct from 'number' or (v_history ? 'note' and jsonb_typeof(v_history->'note') is distinct from 'string') then return false; end if;
    end loop;
    if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(coalesce(v_contract->'activity','[]'::jsonb))) then return false; end if;
    v_previous:=null; v_last:=null;
    for v_activity in select value from jsonb_array_elements(coalesce(v_contract->'activity','[]'::jsonb)) loop
      if jsonb_typeof(v_activity) is distinct from 'object' or jsonb_typeof(v_activity->'id') is distinct from 'string' or coalesce(length(v_activity->>'id'),0) not between 1 and 160 or jsonb_typeof(v_activity->'at') is distinct from 'string' or jsonb_typeof(v_activity->'reason') is distinct from 'string' or coalesce(length(trim(v_activity->>'reason')),0) not between 1 and 2000 then return false; end if;
      if v_activity->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
      v_when:=(v_activity->>'at')::timestamptz;
      if v_last is not null and v_last>v_when then return false; end if;
      if not(v_activity ? 'before') or (v_activity->'before'<>'null'::jsonb and not public.contract_snapshot_is_valid(v_activity->'before',p_document)) or not public.contract_snapshot_is_valid(v_activity->'after',p_document) then return false; end if;
      if coalesce(v_activity#>>'{after,basis}','fixed') in ('day','sqft') and (
        jsonb_typeof(coalesce(v_activity#>'{after,rate}','0'::jsonb)) is distinct from 'number' or
        round(translate(coalesce(v_activity#>>'{after,quantity}','1'),'০১২৩৪৫৬৭৮৯','0123456789')::numeric * coalesce(v_activity#>>'{after,rate}','0')::numeric) is distinct from (v_activity#>>'{after,total}')::numeric
      ) then return false; end if;
      if v_previous is not null and public.contract_terms(v_activity->'before')<>public.contract_terms(v_previous) then return false; end if;
      v_previous:=v_activity->'after'; v_last:=v_when;
    end loop;
    if v_previous is not null and public.contract_terms(v_previous)<>public.contract_terms(v_contract) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

alter table public.ledger_documents add constraint ledger_contracts_valid check(public.ledger_contracts_are_valid(document));

create or replace function public.ledger_evolution_is_valid(p_before jsonb, p_after jsonb)
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
  for v_previous in select value from jsonb_array_elements(p_before->'contracts') loop
    select value into v_next from jsonb_array_elements(p_after->'contracts') where value->>'id'=v_previous->>'id';
    for v_field in select unnest(array['history','activity']) loop
      v_history:=coalesce(v_previous->v_field,'[]'::jsonb);
      if v_next is null then
        if jsonb_array_length(v_history)>0 then return false; end if;
      else
        if jsonb_typeof(coalesce(v_next->v_field,'[]'::jsonb)) is distinct from 'array' or jsonb_array_length(coalesce(v_next->v_field,'[]'::jsonb))<jsonb_array_length(v_history) then return false; end if;
        select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_prefix from jsonb_array_elements(coalesce(v_next->v_field,'[]'::jsonb)) with ordinality where ordinality<=jsonb_array_length(v_history);
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
  if p_kind is not null and p_kind not in ('expense','payment','expense_credit','refund') then raise exception 'invalid_share_filter'; end if;
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
      'remaining', greatest((c->>'total')::numeric - paid, 0)
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
      ((not v_driver or v_link.account <> 'other') and effective_account = v_link.account) or
      (v_driver and v_link.account = 'other' and (
        e->>'id' in (select id from transport_bills) or
        (e->>'kind' in ('payment','refund') and effective_account = 'other' and
          (e->>'relatedEntryId' is null or e->>'relatedEntryId' in (select id from transport_bills)))
      ))
    )
  ), parts as (
    select e, effective_account, part, ord from scoped cross join lateral jsonb_array_elements(
      case when e->>'kind' in ('expense','expense_credit') then e->'lines' else e->'allocations' end
    ) with ordinality as x(part, ord)
    where v_link.work_id is null or part->>'workId' = v_link.work_id
  ), balances as (
    select effective_account, case when v_link.work_id is null then null else part->>'workId' end, e->>'contractId',
      sum(case when e->>'kind' = 'expense' then (part->>'amount')::numeric when e->>'kind' = 'expense_credit' then -(part->>'amount')::numeric else 0 end) cost,
      sum(case when e->>'kind' = 'payment' then (part->>'amount')::numeric when e->>'kind' = 'refund' then -(part->>'amount')::numeric else 0 end) paid
    from parts where coalesce(e->>'balanceImpact','normal') <> 'historical'
    group by effective_account, case when v_link.work_id is null then null else part->>'workId' end, e->>'contractId'
  ), rows as (
    select e->>'id' id, e->>'date' date, e->>'createdAt' created, e->>'kind' kind,
      coalesce(e->>'balanceImpact','normal') = 'historical' historical,
      sum(case when e->>'kind' = 'expense' then (part->>'amount')::numeric when e->>'kind' = 'expense_credit' then -(part->>'amount')::numeric else 0 end) charge,
      sum(case when e->>'kind' = 'payment' then (part->>'amount')::numeric when e->>'kind' = 'refund' then -(part->>'amount')::numeric else 0 end) paid,
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
    'counts', jsonb_build_object('expense', (select count(*) from rows where kind = 'expense'), 'payment', (select count(*) from rows where kind = 'payment'), 'expense_credit', (select count(*) from rows where kind = 'expense_credit'), 'refund', (select count(*) from rows where kind = 'refund')),
    'contracts', v_contracts,
    'nextOffset', case when p_offset + p_limit < (select count(*) from rows where p_kind is null or kind = p_kind) then p_offset + p_limit else null end,
    'totals', jsonb_build_object(
      'cost', coalesce((select sum(charge) from rows),0),
      'paid', coalesce((select sum(paid) from balances),0),
      'payable', coalesce((select sum(greatest(cost-paid,0)) from balances),0),
      'advance', coalesce((select sum(greatest(paid-cost,0)) from balances),0),
      'historicalCost', coalesce((select sum(charge) from rows where historical),0)
    ),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'key', id, 'date', date, 'kind', kind, 'historical', historical,
      'charge', charge, 'paid', paid, 'description', description, 'works', works
    ) order by date desc nulls last, created desc, id desc) from page), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;


revoke all on function public.read_contact_share(text, integer, integer, bigint, text) from public, anon, authenticated;
grant execute on function public.read_contact_share(text, integer, integer, bigint, text) to anon, authenticated;
notify pgrst, 'reload schema';
revoke all on function public.contract_terms(jsonb) from public,anon,authenticated;
revoke all on function public.contract_snapshot_is_valid(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.ledger_contracts_are_valid(jsonb) from public,anon,authenticated;

commit;

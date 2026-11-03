begin;

create or replace function public.contract_terms(p_contract jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object(
    'status',coalesce(p_contract->'status','null'::jsonb),
    'scope',coalesce(p_contract->>'scope','work'),'workId',p_contract->>'workId','personId',p_contract->>'personId',
    'title',coalesce(p_contract->>'title',''),'basis',coalesce(p_contract->>'basis','fixed'),
    'quantity',translate(coalesce(p_contract->>'quantity','1'),'০১২৩৪৫৬৭৮৯','0123456789'),
    'rate',coalesce(p_contract->'rate','0'::jsonb),'total',p_contract->'total',
    'calculatedTotal',coalesce(p_contract->'calculatedTotal','null'::jsonb),
    'notes',coalesce(p_contract->>'notes',''),'agreedOn',p_contract->>'agreedOn'
  );
$$;

create or replace function public.contract_snapshot_is_valid(p_contract jsonb,p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_scope text; v_quantity text; v_date text;
begin
  if jsonb_typeof(p_contract) is distinct from 'object' then return false; end if;
  if p_contract ? 'status' and p_contract->'status'<>'null'::jsonb and (jsonb_typeof(p_contract->'status') is distinct from 'string' or p_contract->>'status' not in ('planned','ongoing','done')) then return false; end if;
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
  if p_contract ? 'calculatedTotal' and p_contract->'calculatedTotal'<>'null'::jsonb then
    if coalesce(p_contract->>'basis','fixed')='fixed' then return false; end if;
    if jsonb_typeof(p_contract->'calculatedTotal') is distinct from 'number' or
       (p_contract->>'calculatedTotal')::numeric<=0 or
       (p_contract->>'calculatedTotal')::numeric>9007199254740991 or
       trunc((p_contract->>'calculatedTotal')::numeric)<>(p_contract->>'calculatedTotal')::numeric then return false; end if;
    if jsonb_typeof(p_contract->'rate') is distinct from 'number' or
       (p_contract->>'rate')::numeric<=0 or
       (p_contract->>'rate')::numeric>9007199254740991 or
       trunc((p_contract->>'rate')::numeric)<>(p_contract->>'rate')::numeric then return false; end if;
    if round(v_quantity::numeric*(p_contract->>'rate')::numeric) is distinct from (p_contract->>'calculatedTotal')::numeric then return false; end if;
  end if;
  v_date:=p_contract->>'agreedOn';
  if v_date is not null and (v_date !~ '^\d{4}-\d{2}-\d{2}$' or to_char(to_date(v_date,'YYYY-MM-DD'),'YYYY-MM-DD')<>v_date) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.ledger_contracts_are_valid(p_document jsonb)
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
        round(translate(coalesce(v_activity#>>'{after,quantity}','1'),'০১২৩৪৫৬৭৮৯','0123456789')::numeric * coalesce(v_activity#>>'{after,rate}','0')::numeric) is distinct from coalesce(v_activity#>>'{after,calculatedTotal}',v_activity#>>'{after,total}')::numeric
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

create or replace function public.contract_activity_for_comparison(p_event jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_event jsonb:=p_event; v_field text;
begin
  foreach v_field in array array['before','after'] loop
    if jsonb_typeof(v_event->v_field)='object' then
      v_event:=jsonb_set(v_event,array[v_field,'status'],coalesce(v_event->v_field->'status','null'::jsonb),true);
      v_event:=jsonb_set(v_event,array[v_field,'calculatedTotal'],coalesce(v_event->v_field->'calculatedTotal','null'::jsonb),true);
    end if;
  end loop;
  return v_event;
end;
$$;

notify pgrst,'reload schema';

commit;

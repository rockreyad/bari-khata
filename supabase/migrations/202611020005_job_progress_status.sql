begin;

create or replace function public.contract_terms(p_contract jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,pg_temp as $$
  select jsonb_build_object(
    'status',coalesce(p_contract->'status','null'::jsonb),
    'scope',coalesce(p_contract->>'scope','work'),'workId',p_contract->>'workId','personId',p_contract->>'personId',
    'title',coalesce(p_contract->>'title',''),'basis',coalesce(p_contract->>'basis','fixed'),
    'quantity',translate(coalesce(p_contract->>'quantity','1'),'০১২৩৪৫৬৭৮৯','0123456789'),
    'rate',coalesce(p_contract->'rate','0'::jsonb),'total',p_contract->'total',
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
  v_date:=p_contract->>'agreedOn';
  if v_date is not null and (v_date !~ '^\d{4}-\d{2}-\d{2}$' or to_char(to_date(v_date,'YYYY-MM-DD'),'YYYY-MM-DD')<>v_date) then return false; end if;
  return true;
exception when others then return false;
end;
$$;

create function public.contract_activity_for_comparison(p_event jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_event jsonb:=p_event; v_field text;
begin
  foreach v_field in array array['before','after'] loop
    if jsonb_typeof(v_event->v_field)='object' then
      v_event:=jsonb_set(v_event,array[v_field,'status'],coalesce(v_event->v_field->'status','null'::jsonb),true);
    end if;
  end loop;
  return v_event;
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

revoke all on function public.contract_activity_for_comparison(jsonb) from public,anon,authenticated;
notify pgrst,'reload schema';

commit;

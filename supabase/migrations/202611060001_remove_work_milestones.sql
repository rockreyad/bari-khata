begin;

create or replace function public.party_ledger_architecture_is_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
  v_row jsonb; v_entry jsonb; v_payment jsonb; v_bill jsonb;
  v_active jsonb; v_snapshot jsonb; v_work text; v_total numeric; v_available numeric;
  v_allocations jsonb:=coalesce(p_document->'paymentAllocations','[]'::jsonb);
begin
  if p_document ? 'architectureVersion' and p_document->'architectureVersion' is distinct from '2'::jsonb then return false; end if;
  if p_document->'architectureVersion'='2'::jsonb and not(p_document ? 'paymentAllocations') then return false; end if;
  if jsonb_typeof(v_allocations) is distinct from 'array' or jsonb_array_length(v_allocations)>100000 then return false; end if;
  for v_row in select value from jsonb_array_elements(p_document->'people') loop
    if v_row ? 'identityType' and (jsonb_typeof(v_row->'identityType') is distinct from 'string' or v_row->>'identityType' not in ('person','organization')) then return false; end if;
    if v_row ? 'roles' then
      if jsonb_typeof(v_row->'roles') is distinct from 'array' or jsonb_array_length(v_row->'roles')>8 then return false; end if;
      if exists(select 1 from jsonb_array_elements(v_row->'roles') role where jsonb_typeof(role)<>'string' or role#>>'{}' not in ('supplier','craftsperson','labour','contractor','professional','transport','service','custom'))
        or (select count(*)<>count(distinct role) from jsonb_array_elements(v_row->'roles') role) then return false; end if;
    end if;
  end loop;
  foreach v_work in array array['paymentAllocations'] loop
    if exists(select 1 from jsonb_array_elements(coalesce(p_document->v_work,'[]'::jsonb)) row where jsonb_typeof(row)<>'object' or jsonb_typeof(row->'id') is distinct from 'string' or length(btrim(row->>'id')) not between 1 and 160)
      or (select count(*)<>count(distinct row->>'id') from jsonb_array_elements(coalesce(p_document->v_work,'[]'::jsonb)) row) then return false; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_allocations) loop
    if jsonb_typeof(v_row->'amount') is distinct from 'number' or coalesce((v_row->>'amount')::numeric,0)<=0
      or (v_row->>'amount')::numeric>9007199254740991 or trunc((v_row->>'amount')::numeric)<>(v_row->>'amount')::numeric then return false; end if;
  end loop;
  for v_entry in select value from jsonb_array_elements(p_document->'entries') loop
    for v_snapshot in select value from jsonb_array_elements(jsonb_build_array(v_entry)||coalesce((select jsonb_agg(value->'before') from jsonb_array_elements(coalesce(v_entry->'revisions','[]'::jsonb))),'[]'::jsonb)) loop
      if v_snapshot ? 'paymentContext' and (jsonb_typeof(v_snapshot->'paymentContext') is distinct from 'string' or v_snapshot->>'paymentContext' not in ('settlement','advance','receivable') or v_snapshot->>'kind' not in ('payment','refund')) then return false; end if;
      if v_snapshot ? 'paymentContext' and v_snapshot->>'personId' is null and not(v_snapshot->>'paymentContext'='settlement' and v_snapshot->>'relatedEntryId' is not null) then return false; end if;
    end loop;
  end loop;
  for v_row in select value from jsonb_array_elements(v_allocations) loop
    if jsonb_typeof(v_row->'paymentId') is distinct from 'string' or length(btrim(v_row->>'paymentId')) not between 1 and 160
      or jsonb_typeof(v_row->'billId') is distinct from 'string' or length(btrim(v_row->>'billId')) not between 1 and 160
      or jsonb_typeof(v_row->'createdAt') is distinct from 'string' or v_row->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T'
      or (v_row ? 'workId' and (jsonb_typeof(v_row->'workId') is distinct from 'string' or length(btrim(v_row->>'workId')) not between 1 and 160)) then return false; end if;
    perform (v_row->>'createdAt')::timestamptz;
    if (v_row ? 'cancelledAt')<>(v_row ? 'cancellationReason') then return false; end if;
    if v_row ? 'cancelledAt' then
      if jsonb_typeof(v_row->'cancelledAt') is distinct from 'string' or jsonb_typeof(v_row->'cancellationReason') is distinct from 'string'
        or length(btrim(v_row->>'cancellationReason')) not between 1 and 2000
        or (v_row->>'cancelledAt')::timestamptz < (v_row->>'createdAt')::timestamptz
        or not exists(select 1 from jsonb_array_elements(p_document->'entries') where value->>'id'=v_row->>'paymentId')
        or not exists(select 1 from jsonb_array_elements(p_document->'entries') where value->>'id'=v_row->>'billId') then return false; end if;
    end if;
  end loop;
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_active from jsonb_array_elements(v_allocations) where not(value ? 'cancelledAt');
  for v_row in select value from jsonb_array_elements(v_active) loop
    select value into v_payment from jsonb_array_elements(p_document->'entries') where value->>'id'=v_row->>'paymentId';
    select value into v_bill from jsonb_array_elements(p_document->'entries') where value->>'id'=v_row->>'billId';
    if v_payment is null or v_bill is null or v_payment->>'kind'<>'payment' or v_bill->>'kind'<>'expense'
      or v_payment->>'personId' is null or v_payment->>'personId' is distinct from v_bill->>'personId'
      or v_payment->>'account' is distinct from v_bill->>'account' or v_payment->>'contractId' is distinct from v_bill->>'contractId'
      or coalesce((v_payment->>'voided')::boolean,false) or coalesce((v_bill->>'voided')::boolean,false)
      or coalesce(v_payment->>'balanceImpact','normal')<>'normal' or coalesce(v_bill->>'balanceImpact','normal')<>'normal'
      or coalesce(v_payment->>'reviewStatus','confirmed')<>'confirmed' or coalesce(v_bill->>'reviewStatus','confirmed')<>'confirmed'
      or jsonb_typeof(v_row->'createdAt') is distinct from 'string' or v_row->>'createdAt' !~ '^\d{4}-\d{2}-\d{2}T' then return false; end if;
    perform (v_row->>'createdAt')::timestamptz;
    v_work:=v_row->>'workId';
    if v_work is null then
      if (select count(distinct value->>'workId') from jsonb_array_elements(v_bill->'lines'))<>1 then return false; end if;
      v_work:=v_bill#>>'{lines,0,workId}';
    end if;
    if not exists(select 1 from jsonb_array_elements(v_bill->'lines') where value->>'workId'=v_work)
      or not exists(select 1 from jsonb_array_elements(v_payment->'allocations') where value->>'workId'=v_work) then return false; end if;
    select sum((value->>'amount')::numeric) into v_total from jsonb_array_elements(v_active) where value->>'paymentId'=v_payment->>'id';
    select sum((value->>'amount')::numeric) into v_available from jsonb_array_elements(v_payment->'paymentParts');
    if v_total>v_available then return false; end if;
    select sum((value->>'amount')::numeric) into v_total from jsonb_array_elements(v_active) where value->>'billId'=v_bill->>'id';
    select sum((value->>'amount')::numeric) into v_available from jsonb_array_elements(v_bill->'lines');
    select v_available-coalesce(sum((line->>'amount')::numeric),0) into v_available from jsonb_array_elements(p_document->'entries') credit
      cross join lateral jsonb_array_elements(credit->'lines') line where credit->>'kind'='expense_credit' and credit->>'relatedEntryId'=v_bill->>'id'
      and not coalesce((credit->>'voided')::boolean,false) and coalesce(credit->>'balanceImpact','normal')='normal';
    if v_total>greatest(0,v_available) then return false; end if;
    select sum((allocation->>'amount')::numeric) into v_total from jsonb_array_elements(v_active) allocation
      join lateral (select value from jsonb_array_elements(p_document->'entries') where value->>'id'=allocation->>'billId') bill on true
      where allocation->>'paymentId'=v_payment->>'id' and coalesce(allocation->>'workId',bill.value#>>'{lines,0,workId}')=v_work;
    select coalesce(sum((value->>'amount')::numeric),0) into v_available from jsonb_array_elements(v_payment->'allocations') where value->>'workId'=v_work;
    if v_total>v_available then return false; end if;
    select coalesce(sum((allocation->>'amount')::numeric),0) into v_total from jsonb_array_elements(v_active) allocation
      where allocation->>'billId'=v_bill->>'id' and coalesce(allocation->>'workId',v_bill#>>'{lines,0,workId}')=v_work;
    select coalesce(sum((value->>'amount')::numeric),0) into v_available from jsonb_array_elements(v_bill->'lines') where value->>'workId'=v_work;
    select v_available-coalesce(sum((line->>'amount')::numeric),0) into v_available from jsonb_array_elements(p_document->'entries') credit
      cross join lateral jsonb_array_elements(credit->'lines') line where credit->>'kind'='expense_credit' and credit->>'relatedEntryId'=v_bill->>'id'
      and line->>'workId'=v_work and not coalesce((credit->>'voided')::boolean,false) and coalesce(credit->>'balanceImpact','normal')='normal';
    if v_total>greatest(0,v_available) then return false; end if;
    select coalesce(sum((line->>'amount')::numeric*(case when cash->>'kind'='refund' then -1 else 1 end)),0) into v_available
      from jsonb_array_elements(p_document->'entries') cash cross join lateral jsonb_array_elements(cash->'allocations') line
      where cash->>'kind' in ('payment','refund') and cash->>'personId'=v_payment->>'personId' and cash->>'account'=v_payment->>'account'
        and cash->>'contractId' is not distinct from v_payment->>'contractId' and line->>'workId'=v_work
        and not coalesce((cash->>'voided')::boolean,false) and coalesce(cash->>'balanceImpact','normal')='normal';
    select coalesce(sum((allocation->>'amount')::numeric),0) into v_total from jsonb_array_elements(v_active) allocation
      join lateral (select value from jsonb_array_elements(p_document->'entries') where value->>'id'=allocation->>'paymentId') payment on true
      join lateral (select value from jsonb_array_elements(p_document->'entries') where value->>'id'=allocation->>'billId') bill on true
      where payment.value->>'personId'=v_payment->>'personId' and payment.value->>'account'=v_payment->>'account'
        and payment.value->>'contractId' is not distinct from v_payment->>'contractId' and coalesce(allocation->>'workId',bill.value#>>'{lines,0,workId}')=v_work;
    if v_total>greatest(0,v_available) then return false; end if;
    select coalesce(sum((line->>'amount')::numeric*(case when cash->>'kind'='refund' then -1 else 1 end)),0) into v_available
      from jsonb_array_elements(p_document->'entries') cash cross join lateral jsonb_array_elements(cash->'allocations') line
      where cash->>'kind' in ('payment','refund') and cash->>'personId'=v_payment->>'personId' and cash->>'account'=v_payment->>'account'
        and cash->>'contractId' is not distinct from v_payment->>'contractId' and line->>'workId'=v_work
        and cash->>'paymentContext' is not distinct from v_payment->>'paymentContext'
        and not coalesce((cash->>'voided')::boolean,false) and coalesce(cash->>'balanceImpact','normal')='normal';
    select coalesce(sum((allocation->>'amount')::numeric),0) into v_total from jsonb_array_elements(v_active) allocation
      join lateral (select value from jsonb_array_elements(p_document->'entries') where value->>'id'=allocation->>'paymentId') payment on true
      join lateral (select value from jsonb_array_elements(p_document->'entries') where value->>'id'=allocation->>'billId') bill on true
      where payment.value->>'personId'=v_payment->>'personId' and payment.value->>'account'=v_payment->>'account'
        and payment.value->>'contractId' is not distinct from v_payment->>'contractId'
        and payment.value->>'paymentContext' is not distinct from v_payment->>'paymentContext'
        and coalesce(allocation->>'workId',bill.value#>>'{lines,0,workId}')=v_work;
    if v_total>greatest(0,v_available) then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function public.preserve_party_ledger_architecture()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare v_row jsonb; v_next jsonb; v_key text;
begin
  if old.document->'architectureVersion'='2'::jsonb and new.document->'architectureVersion' is distinct from '2'::jsonb then raise exception 'architecture_would_be_lost'; end if;
  foreach v_key in array array['paymentAllocations'] loop
    if old.document ? v_key and not(new.document ? v_key) then raise exception 'architecture_would_be_lost'; end if;
    for v_row in select value from jsonb_array_elements(coalesce(old.document->v_key,'[]'::jsonb)) loop
      select value into v_next from jsonb_array_elements(coalesce(new.document->v_key,'[]'::jsonb)) where value->>'id'=v_row->>'id';
      if v_next is null then raise exception 'architecture_history_would_be_lost'; end if;
      if v_key='paymentAllocations' and v_next<>v_row and not(not(v_row ? 'cancelledAt') and v_next ?& array['cancelledAt','cancellationReason'] and v_next-array['cancelledAt','cancellationReason']=v_row) then raise exception 'architecture_history_would_be_lost'; end if;
    end loop;
  end loop;
  for v_row in select value from jsonb_array_elements(old.document->'people') loop
    select value into v_next from jsonb_array_elements(new.document->'people') where value->>'id'=v_row->>'id';
    if (v_row ? 'roles' and not coalesce(v_next ? 'roles',false)) or (v_row ? 'identityType' and not coalesce(v_next ? 'identityType',false)) then raise exception 'party_identity_would_be_lost'; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(old.document->'entries') loop
    select value into v_next from jsonb_array_elements(new.document->'entries') where value->>'id'=v_row->>'id';
    if (v_row ? 'paymentContext' and not coalesce(v_next ? 'paymentContext',false)) then raise exception 'architecture_history_would_be_lost'; end if;
  end loop;
  return new;
end;
$$;

create or replace function private.mcp_document_changes(p_before jsonb,p_after jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_scopes text[]:=array['ledger:read']; v_ids text[]:='{}'; v_entry jsonb; v_old jsonb; v_key text; v_amount numeric:=0; v_new_amount numeric; v_old_amount numeric;
begin
  if p_before is not null and p_before->'project' is distinct from p_after->'project' then raise exception 'mcp_forbidden'; end if;
  foreach v_key in array array['works','people','contracts','items','materialGroups','paymentPurposes','paymentAllocations'] loop
    if private.mcp_comparable(coalesce(p_before->v_key,'[]'::jsonb),v_key) is distinct from private.mcp_comparable(coalesce(p_after->v_key,'[]'::jsonb),v_key) then
      v_scopes:=array_append(v_scopes,case when v_key in ('works','people') then 'entities:write' when v_key='contracts' then 'contracts:write' when v_key='paymentAllocations' then 'entries:update' else 'catalog:write' end);
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
    select coalesce(sum((x->>'amount')::numeric),0) into v_new_amount from jsonb_array_elements(coalesce(v_entry->'lines','[]'::jsonb)||coalesce(v_entry->'paymentParts','[]'::jsonb)) x;
    select coalesce(sum((x->>'amount')::numeric),0) into v_old_amount from jsonb_array_elements(coalesce(v_old->'lines','[]'::jsonb)||coalesce(v_old->'paymentParts','[]'::jsonb)) x;
    if v_old is null or private.mcp_comparable(v_old-array['receipts','updatedAt','revisions','provenance'],'entries') is distinct from private.mcp_comparable(v_entry-array['receipts','updatedAt','revisions','provenance'],'entries') then
      v_amount:=greatest(v_amount,v_new_amount,v_old_amount);
    end if;
    if coalesce(v_entry->'receipts','[]'::jsonb) is distinct from coalesce(v_old->'receipts','[]'::jsonb) then
      v_scopes:=array_append(v_scopes,'receipts:write');
    end if;
  end loop;
  foreach v_key in array array['paymentAllocations'] loop
    for v_entry in select value from jsonb_array_elements(coalesce(p_after->v_key,'[]'::jsonb)) loop
      select value into v_old from jsonb_array_elements(coalesce(p_before->v_key,'[]'::jsonb)) old where old->>'id'=v_entry->>'id';
      if v_old is distinct from v_entry then
        v_amount:=greatest(v_amount,(v_entry->>'amount')::numeric,coalesce((v_old->>'amount')::numeric,0));
        v_ids:=array_append(v_ids,v_entry->>'id');
        if v_key='paymentAllocations' then v_ids:=array_append(array_append(v_ids,v_entry->>'paymentId'),v_entry->>'billId'); end if;
      end if;
    end loop;
  end loop;
  select array_agg(distinct s order by s) into v_scopes from unnest(v_scopes) s;
  if v_amount>9007199254740991 or v_amount<0 or trunc(v_amount)<>v_amount then raise exception 'mcp_invalid_document'; end if;
  return jsonb_build_object('requiredScopes',to_jsonb(v_scopes),'amountPaisa',v_amount,'entryIds',to_jsonb(v_ids));
end;
$$;


create function private.strip_retired_work_metadata(p_document jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_document jsonb:=p_document-'milestones'; v_entries jsonb:='[]'::jsonb; v_entry jsonb; v_revisions jsonb;
begin
  if jsonb_typeof(p_document) is distinct from 'object' or jsonb_typeof(p_document->'entries') is distinct from 'array' then return v_document; end if;
  if not(p_document ? 'milestones') and not jsonb_path_exists(p_document,'$.entries[*].milestoneId')
    and not jsonb_path_exists(p_document,'$.entries[*].revisions[*].before.milestoneId') then return p_document; end if;
  for v_entry in select value from jsonb_array_elements(p_document->'entries') loop
    if jsonb_typeof(v_entry)='object' then
      v_entry:=v_entry-'milestoneId';
      if jsonb_typeof(v_entry->'revisions')='array' then
        select coalesce(jsonb_agg(case when jsonb_typeof(r.value->'before')='object'
          then jsonb_set(r.value,'{before}',(r.value->'before')-'milestoneId') else r.value end order by r.ordinality),'[]'::jsonb)
          into v_revisions from jsonb_array_elements(v_entry->'revisions') with ordinality r(value,ordinality);
        v_entry:=jsonb_set(v_entry,'{revisions}',v_revisions);
      end if;
    end if;
    v_entries:=v_entries||jsonb_build_array(v_entry);
  end loop;
  return jsonb_set(v_document,'{entries}',v_entries);
end;
$$;

create function public.normalize_retired_work_metadata()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  new.document:=private.strip_retired_work_metadata(new.document);
  return new;
end;
$$;

revoke all on function private.strip_retired_work_metadata(jsonb),public.normalize_retired_work_metadata() from public,anon,authenticated;
create trigger ledger_00_normalize_retired_work_metadata before insert or update of document on public.ledger_documents
  for each row execute function public.normalize_retired_work_metadata();

create or replace function public.balance_adjustments_are_preserved(p_before jsonb,p_after jsonb)
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
    select coalesce(jsonb_agg(jsonb_set(value,'{before}',(value->'before')-'milestoneId') order by ordinality),'[]'::jsonb) into v_history
      from jsonb_array_elements(coalesce(v_old->'revisions','[]'::jsonb)) with ordinality;
    select coalesce(jsonb_agg(jsonb_set(value,'{before}',(value->'before')-'milestoneId') order by ordinality),'[]'::jsonb) into v_prefix
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

-- শুধু তুলে দেওয়া তথ্য সরছে; revision ও অনুরোধের hash রাখায় অসমাপ্ত সিঙ্কে অকারণ সংঘাত বা দ্বিগুণ হিসাব হবে না।
update public.ledger_documents
set document=private.strip_retired_work_metadata(document)
where document is distinct from private.strip_retired_work_metadata(document);

notify pgrst,'reload schema';
commit;

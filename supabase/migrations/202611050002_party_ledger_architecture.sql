begin;

create function public.party_ledger_architecture_is_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
  v_row jsonb; v_entry jsonb; v_payment jsonb; v_bill jsonb; v_contract jsonb;
  v_active jsonb; v_milestone jsonb; v_snapshot jsonb; v_work text; v_total numeric; v_available numeric;
  v_allocations jsonb:=coalesce(p_document->'paymentAllocations','[]'::jsonb);
  v_milestones jsonb:=coalesce(p_document->'milestones','[]'::jsonb);
begin
  if p_document ? 'architectureVersion' and p_document->'architectureVersion' is distinct from '2'::jsonb then return false; end if;
  if p_document->'architectureVersion'='2'::jsonb and not(p_document ?& array['paymentAllocations','milestones']) then return false; end if;
  if jsonb_typeof(v_allocations) is distinct from 'array' or jsonb_array_length(v_allocations)>100000
    or jsonb_typeof(v_milestones) is distinct from 'array' or jsonb_array_length(v_milestones)>10000 then return false; end if;
  for v_row in select value from jsonb_array_elements(p_document->'people') loop
    if v_row ? 'identityType' and (jsonb_typeof(v_row->'identityType') is distinct from 'string' or v_row->>'identityType' not in ('person','organization')) then return false; end if;
    if v_row ? 'roles' then
      if jsonb_typeof(v_row->'roles') is distinct from 'array' or jsonb_array_length(v_row->'roles')>8 then return false; end if;
      if exists(select 1 from jsonb_array_elements(v_row->'roles') role where jsonb_typeof(role)<>'string' or role#>>'{}' not in ('supplier','craftsperson','labour','contractor','professional','transport','service','custom'))
        or (select count(*)<>count(distinct role) from jsonb_array_elements(v_row->'roles') role) then return false; end if;
    end if;
  end loop;
  foreach v_work in array array['milestones','paymentAllocations'] loop
    if exists(select 1 from jsonb_array_elements(coalesce(p_document->v_work,'[]'::jsonb)) row where jsonb_typeof(row)<>'object' or jsonb_typeof(row->'id') is distinct from 'string' or length(btrim(row->>'id')) not between 1 and 160)
      or (select count(*)<>count(distinct row->>'id') from jsonb_array_elements(coalesce(p_document->v_work,'[]'::jsonb)) row) then return false; end if;
  end loop;
  for v_row in select value from jsonb_array_elements(v_milestones||v_allocations) loop
    if jsonb_typeof(v_row->'amount') is distinct from 'number' or coalesce((v_row->>'amount')::numeric,0)<=0
      or (v_row->>'amount')::numeric>9007199254740991 or trunc((v_row->>'amount')::numeric)<>(v_row->>'amount')::numeric then return false; end if;
  end loop;
  for v_milestone in select value from jsonb_array_elements(v_milestones) loop
    select value into v_contract from jsonb_array_elements(p_document->'contracts') where value->>'id'=v_milestone->>'contractId';
    if v_contract is null or jsonb_typeof(v_milestone->'title') is distinct from 'string' or length(btrim(v_milestone->>'title')) not between 1 and 300
      or coalesce(v_milestone->>'status','') not in ('planned','ongoing','done') then return false; end if;
    if v_milestone->>'dueOn' is not null and (v_milestone->>'dueOn' !~ '^\d{4}-\d{2}-\d{2}$' or to_char(to_date(v_milestone->>'dueOn','YYYY-MM-DD'),'YYYY-MM-DD')<>v_milestone->>'dueOn') then return false; end if;
    select sum((value->>'amount')::numeric) into v_total from jsonb_array_elements(v_milestones) where value->>'contractId'=v_contract->>'id';
    if v_total>(v_contract->>'total')::numeric then return false; end if;
  end loop;
  for v_entry in select value from jsonb_array_elements(p_document->'entries') loop
    for v_snapshot in select value from jsonb_array_elements(jsonb_build_array(v_entry)||coalesce((select jsonb_agg(value->'before') from jsonb_array_elements(coalesce(v_entry->'revisions','[]'::jsonb))),'[]'::jsonb)) loop
      if v_snapshot ? 'paymentContext' and (jsonb_typeof(v_snapshot->'paymentContext') is distinct from 'string' or v_snapshot->>'paymentContext' not in ('settlement','advance','receivable') or v_snapshot->>'kind' not in ('payment','refund')) then return false; end if;
      if v_snapshot ? 'paymentContext' and v_snapshot->>'personId' is null and not(v_snapshot->>'paymentContext'='settlement' and v_snapshot->>'relatedEntryId' is not null) then return false; end if;
      if v_snapshot ? 'milestoneId' and v_snapshot->'milestoneId'<>'null'::jsonb and jsonb_typeof(v_snapshot->'milestoneId')<>'string' then return false; end if;
      if v_snapshot->>'milestoneId' is not null then
        select value into v_milestone from jsonb_array_elements(v_milestones) where value->>'id'=v_snapshot->>'milestoneId';
        if v_milestone is null or v_snapshot->>'kind'<>'expense' or v_snapshot->>'contractId' is distinct from v_milestone->>'contractId' then return false; end if;
        select value into v_contract from jsonb_array_elements(p_document->'contracts') where value->>'id'=v_milestone->>'contractId';
        if v_snapshot->>'personId' is distinct from v_contract->>'personId' or v_snapshot->>'account' is distinct from 'labour'
          or (coalesce(v_contract->>'scope','work')='work' and exists(select 1 from jsonb_array_elements(v_snapshot->'lines') line where line->>'workId' is distinct from v_contract->>'workId')) then return false; end if;
      end if;
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

create function public.preserve_party_ledger_architecture()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare v_row jsonb; v_next jsonb; v_key text;
begin
  if old.document->'architectureVersion'='2'::jsonb and new.document->'architectureVersion' is distinct from '2'::jsonb then raise exception 'architecture_would_be_lost'; end if;
  foreach v_key in array array['paymentAllocations','milestones'] loop
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
    if (v_row ? 'paymentContext' and not coalesce(v_next ? 'paymentContext',false)) or (v_row ? 'milestoneId' and not coalesce(v_next ? 'milestoneId',false)) then raise exception 'architecture_history_would_be_lost'; end if;
  end loop;
  return new;
end;
$$;

alter table public.ledger_documents add constraint party_ledger_architecture_valid check(public.party_ledger_architecture_is_valid(document)) not valid;
create trigger ledger_preserve_party_architecture before update of document on public.ledger_documents for each row execute function public.preserve_party_ledger_architecture();
revoke all on function public.party_ledger_architecture_is_valid(jsonb) from public,anon;
grant execute on function public.party_ledger_architecture_is_valid(jsonb) to authenticated,service_role;
revoke all on function public.preserve_party_ledger_architecture() from public,anon,authenticated;

create or replace function private.mcp_document_changes(p_before jsonb,p_after jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_scopes text[]:=array['ledger:read']; v_ids text[]:='{}'; v_entry jsonb; v_old jsonb; v_key text; v_amount numeric:=0; v_new_amount numeric; v_old_amount numeric;
begin
  if p_before is not null and p_before->'project' is distinct from p_after->'project' then raise exception 'mcp_forbidden'; end if;
  foreach v_key in array array['works','people','contracts','items','materialGroups','paymentPurposes','milestones','paymentAllocations'] loop
    if private.mcp_comparable(coalesce(p_before->v_key,'[]'::jsonb),v_key) is distinct from private.mcp_comparable(coalesce(p_after->v_key,'[]'::jsonb),v_key) then
      v_scopes:=array_append(v_scopes,case when v_key in ('works','people') then 'entities:write' when v_key in ('contracts','milestones') then 'contracts:write' when v_key='paymentAllocations' then 'entries:update' else 'catalog:write' end);
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
  foreach v_key in array array['milestones','paymentAllocations'] loop
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


create function private.ledger_obligation_cash_amount(p_document jsonb,p_entry jsonb,p_part jsonb,p_ordinal bigint)
returns numeric language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_total numeric;
begin
  if coalesce(p_entry->>'paymentContext','')<>'receivable' then return coalesce((p_part->>'amount')::numeric,0); end if;
  if p_entry->>'kind'<>'payment' then return 0; end if;
  if exists(select 1 from jsonb_array_elements(p_entry->'allocations') with ordinality x(part,ord) where ord<p_ordinal and part->>'workId'=p_part->>'workId') then return 0; end if;
  select coalesce(sum((allocation->>'amount')::numeric),0) into v_total from jsonb_array_elements(coalesce(p_document->'paymentAllocations','[]'::jsonb)) allocation
    join lateral (select value from jsonb_array_elements(p_document->'entries') where value->>'id'=allocation->>'billId') bill on true
    where allocation->>'paymentId'=p_entry->>'id' and not(allocation ? 'cancelledAt')
      and coalesce(allocation->>'workId',bill.value#>>'{lines,0,workId}')=p_part->>'workId';
  return v_total;
end;
$$;
revoke all on function private.ledger_obligation_cash_amount(jsonb,jsonb,jsonb,bigint) from public,anon,authenticated,service_role;

create or replace function public.read_contact_share(p_token text, p_offset integer default 0, p_limit integer default 40, p_revision bigint default null, p_kind text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.contact_share_links; v_doc jsonb; v_person jsonb; v_revision bigint;
  v_updated timestamptz; v_result jsonb; v_contracts jsonb;
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
  v_contracts := '[]'::jsonb;
  if v_link.account = 'labour' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'title', coalesce(c->>'title',''), 'workName', coalesce(w->>'name',''),
      'total', (c->>'total')::numeric, 'netPaid', paid,
      'remaining', greatest(greatest((c->>'total')::numeric,billed) + adjusted - obligation_paid, 0)
    ) order by c->>'id'), '[]'::jsonb) into v_contracts
    from jsonb_array_elements(v_doc->'contracts') c
    left join lateral (
      select w from jsonb_array_elements(v_doc->'works') w where w->>'id' = c->>'workId'
    ) n on true
    cross join lateral (
      select coalesce(sum((a->>'amount')::numeric * case when e->>'kind' = 'refund' then -1 else 1 end),0) paid,
        coalesce(sum(private.ledger_obligation_cash_amount(v_doc,e,a,ord) * case when e->>'kind'='refund' then -1 else 1 end),0) obligation_paid
      from jsonb_array_elements(v_doc->'entries') e
      cross join lateral jsonb_array_elements(e->'allocations') with ordinality as parts(a,ord)
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
    select e, case when e->>'account' = 'materials' and (
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
    select e, effective_account from classified
    where not coalesce((e->>'voided')::boolean, false)
      and effective_account = v_link.account
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
      sum(case when e->>'kind'='payment' then private.ledger_obligation_cash_amount(v_doc,e,part,ord) when e->>'kind'='refund' then -private.ledger_obligation_cash_amount(v_doc,e,part,ord) else 0 end) obligation_paid,
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
      coalesce(b.obligation_paid,0) paid,
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

notify pgrst,'reload schema';
commit;

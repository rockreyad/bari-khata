begin;

create or replace function public.adjustment_snapshot_is_valid(p_entry jsonb,p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare v_adjustment jsonb; v_field text; v_amount numeric; v_contract jsonb; v_time timestamptz;
begin
  if p_entry->>'kind' is distinct from 'adjustment' then
    return coalesce(p_entry->'adjustment','null'::jsonb)='null'::jsonb;
  end if;
  v_adjustment:=p_entry->'adjustment';
  if jsonb_typeof(v_adjustment) is distinct from 'object'
    or not(v_adjustment ?& array['target','basis','account','delta','before','after','workId'])
    or exists(select 1 from jsonb_object_keys(v_adjustment) k where k not in ('target','basis','account','delta','before','after','workId','calculationVersion'))
    or coalesce(v_adjustment->>'target','') not in ('person','work')
    or coalesce(v_adjustment->>'basis','') not in ('paid','cost','balance')
    or coalesce(p_entry->>'account','') not in ('materials','labour','other')
    or jsonb_typeof(p_entry->'note') is distinct from 'string'
    or length(btrim(p_entry->>'note')) not between 1 and 10000
    or coalesce(p_entry->'balanceImpact','"normal"'::jsonb)<>'"normal"'::jsonb
    or coalesce(p_entry->'reviewStatus','"confirmed"'::jsonb)<>'"confirmed"'::jsonb
    or coalesce(p_entry->'relatedEntryId','null'::jsonb)<>'null'::jsonb
    or coalesce(p_entry->'paymentPurposeId','null'::jsonb)<>'null'::jsonb then return false; end if;
  if v_adjustment ? 'calculationVersion' and (v_adjustment->'calculationVersion' is distinct from '2'::jsonb or v_adjustment->>'basis'<>'balance') then return false; end if;
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

create or replace function private.ledger_unresolved_contract_adjustments(p_document jsonb)
returns text[] language sql immutable set search_path=pg_catalog,pg_temp as $$
  select coalesce(array_agg(e->>'id'),'{}'::text[])
  from jsonb_array_elements(p_document->'entries') e
  where e->>'kind'='adjustment' and not coalesce((e->>'voided')::boolean,false)
    and e->>'contractId' is not null and e#>>'{adjustment,basis}'='balance'
    and e#>'{adjustment,calculationVersion}' is distinct from '2'::jsonb;
$$;
revoke all on function private.ledger_unresolved_contract_adjustments(jsonb) from public,anon,authenticated,service_role;

create or replace function public.read_contact_share(p_token text, p_offset integer default 0, p_limit integer default 40, p_revision bigint default null, p_kind text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.contact_share_links; v_doc jsonb; v_person jsonb; v_revision bigint;
  v_updated timestamptz; v_result jsonb; v_contracts jsonb; v_unresolved text[];
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
  v_unresolved := private.ledger_unresolved_contract_adjustments(v_doc);
  v_contracts := '[]'::jsonb;
  if v_link.account = 'labour' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'title', coalesce(c->>'title',''), 'workName', coalesce(w->>'name',''),
      'total', (c->>'total')::numeric, 'netPaid', paid,
      'remaining', greatest(billed + adjusted - obligation_paid,0),
      'remainingCommitment',greatest(greatest((c->>'total')::numeric,billed)+commitment_adjusted-obligation_paid,0),
      'unearnedCommitment',greatest((c->>'total')::numeric-billed,0)
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
      select coalesce(sum((e#>>'{adjustment,delta}')::numeric * case when e#>>'{adjustment,basis}'='paid' then -1 else 1 end) filter(where not(e->>'id'=any(v_unresolved))),0) adjusted,
        coalesce(sum((e#>>'{adjustment,delta}')::numeric * case when e#>>'{adjustment,basis}'='paid' then -1 else 1 end),0) commitment_adjusted
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
      sum(case when e->>'kind'='adjustment' and not(e->>'id'=any(v_unresolved)) then (e#>>'{adjustment,delta}')::numeric * case when e#>>'{adjustment,basis}'='paid' then -1 else 1 end else 0 end) adjustment,
      sum(case when e->>'kind'='adjustment' and e#>>'{adjustment,basis}'='cost' then (e#>>'{adjustment,delta}')::numeric else 0 end) cost_correction,
      sum(case when e->>'kind'='adjustment' and e#>>'{adjustment,basis}'='paid' then (e#>>'{adjustment,delta}')::numeric else 0 end) paid_correction,
      sum(case when e->>'kind'='adjustment' and not(e->>'id'=any(v_unresolved)) and e#>>'{adjustment,basis}'='balance' then (e#>>'{adjustment,delta}')::numeric else 0 end) balance_correction
    from parts where coalesce(e->>'balanceImpact','normal') <> 'historical'
    group by effective_account, case when v_link.work_id is null then null else part->>'workId' end, e->>'contractId'
  ), jobs as (
    select c job from jsonb_array_elements(v_doc->'contracts') c
    where v_link.account='labour' and c->>'personId'=v_link.person_id
      and (v_link.work_id is null or (coalesce(c->>'scope','work')='work' and c->>'workId'=v_link.work_id))
  ), obligations as (
    select coalesce(b.cost,0) base,
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
      'balanceAmbiguous',exists(select 1 from parts where e->>'id'=any(v_unresolved)),
      'earnedPayable',case when exists(select 1 from parts where e->>'id'=any(v_unresolved)) then null else (select greatest(due-advance+pool,0) from reconciliation) end,
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

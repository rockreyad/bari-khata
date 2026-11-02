begin;

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
        and e->>'contractId' = c->>'id' and a->>'workId' = c->>'workId'
        and e->>'kind' in ('payment','refund')
        and not coalesce((e->>'voided')::boolean, false)
        and coalesce(e->>'balanceImpact','normal') <> 'historical'
    ) payments
    where c->>'personId' = v_link.person_id and (v_link.work_id is null or c->>'workId' = v_link.work_id);
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
    select effective_account, part->>'workId', e->>'contractId',
      sum(case when e->>'kind' = 'expense' then (part->>'amount')::numeric when e->>'kind' = 'expense_credit' then -(part->>'amount')::numeric else 0 end) cost,
      sum(case when e->>'kind' = 'payment' then (part->>'amount')::numeric when e->>'kind' = 'refund' then -(part->>'amount')::numeric else 0 end) paid
    from parts where coalesce(e->>'balanceImpact','normal') <> 'historical'
    group by effective_account, part->>'workId', e->>'contractId'
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

commit;

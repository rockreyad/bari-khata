create table public.contact_share_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  person_id text not null,
  account text not null check (account in ('materials','labour','other')),
  work_id text,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index contact_share_owner on public.contact_share_links(owner_id, person_id);
alter table public.contact_share_links enable row level security;
revoke all on public.contact_share_links from public, anon, authenticated;

create function public.contact_share_status(p_person_id text, p_account text, p_work_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_result jsonb;
begin
  if v_owner is null then raise exception 'authentication_required'; end if;
  select jsonb_build_object('id', id, 'createdAt', created_at) into v_result
  from public.contact_share_links
  where owner_id = v_owner and person_id = p_person_id and account = p_account
    and work_id is not distinct from p_work_id and revoked_at is null
  order by created_at desc limit 1;
  return v_result;
end;
$$;

create function public.create_contact_share(p_person_id text, p_account text, p_work_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := auth.uid(); v_doc jsonb; v_token text; v_id uuid; v_created timestamptz := now();
begin
  if v_owner is null then raise exception 'authentication_required'; end if;
  if p_account is null or p_account not in ('materials','labour','other') then raise exception 'invalid_share_scope'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text, 8));
  select document into v_doc from public.ledger_documents where owner_id = v_owner;
  if v_doc is null or not exists(select 1 from jsonb_array_elements(v_doc->'people') p where p->>'id' = p_person_id)
    or (p_work_id is not null and not exists(select 1 from jsonb_array_elements(v_doc->'works') w where w->>'id' = p_work_id)) then
    raise exception 'invalid_share_scope';
  end if;
  if (select count(*) from public.contact_share_links where owner_id = v_owner and revoked_at is null) >= 1000 then
    raise exception 'share_limit';
  end if;
  update public.contact_share_links set revoked_at = v_created
    where owner_id = v_owner and person_id = p_person_id and account = p_account
      and work_id is not distinct from p_work_id and revoked_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.contact_share_links(owner_id, person_id, account, work_id, token_hash, created_at)
    values(v_owner, p_person_id, p_account, p_work_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_created)
    returning id into v_id;
  return jsonb_build_object('id', v_id, 'createdAt', v_created, 'token', v_token);
end;
$$;

create function public.revoke_contact_share(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'authentication_required'; end if;
  update public.contact_share_links set revoked_at = coalesce(revoked_at, now())
    where owner_id = v_owner and id = p_id;
  return found;
end;
$$;

create function public.read_contact_share(p_token text, p_offset integer default 0, p_limit integer default 40, p_revision bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.contact_share_links; v_doc jsonb; v_person jsonb; v_revision bigint;
  v_updated timestamptz; v_result jsonb; v_driver boolean;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  if p_offset is null or p_offset < 0 or p_offset > 100000 or p_limit is null or p_limit < 1 or p_limit > 60 then
    raise exception 'invalid_share_page';
  end if;
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
    else 'other' end) = 'driver' and v_link.account = 'other';
  with own as (
    select e from jsonb_array_elements(v_doc->'entries') e where e->>'personId' = v_link.person_id
  ), transport_bills as (
    select e->>'id' id from own
    where e->>'kind' in ('expense','expense_credit') and jsonb_array_length(e->'lines') > 0
      and not exists(select 1 from jsonb_array_elements(e->'lines') l where l->>'costType' <> 'transport')
  ), buckets as (
    select e->>'account' account, l->>'workId' work_id, bool_and(l->>'costType' = 'transport') pure
    from own cross join lateral jsonb_array_elements(e->'lines') l
    where e->>'kind' in ('expense','expense_credit') group by e->>'account', l->>'workId'
  ), scoped as (
    select e from own where not coalesce((e->>'voided')::boolean, false) and (
      (not v_driver and e->>'account' = v_link.account) or
      (v_driver and (
        e->>'id' in (select id from transport_bills) or e->>'relatedEntryId' in (select id from transport_bills) or
        (e->>'kind' in ('payment','refund') and e->>'account' = 'other' and
          (e->>'relatedEntryId' is null or e->>'relatedEntryId' in (select id from transport_bills))) or
        (e->>'kind' in ('payment','refund') and e->>'account' = 'materials' and e->>'relatedEntryId' is null
          and jsonb_array_length(e->'allocations') > 0 and not exists(
            select 1 from jsonb_array_elements(e->'allocations') a where not exists(
              select 1 from buckets b where b.account = e->>'account' and b.work_id = a->>'workId' and b.pure
            )
          ))
      ))
    )
  ), parts as (
    select e, part, ord from scoped cross join lateral jsonb_array_elements(
      case when e->>'kind' in ('expense','expense_credit') then e->'lines' else e->'allocations' end
    ) with ordinality as x(part, ord)
    where v_link.work_id is null or part->>'workId' = v_link.work_id
  ), balances as (
    select e->>'account', part->>'workId', e->>'contractId',
      sum(case when e->>'kind' = 'expense' then (part->>'amount')::numeric when e->>'kind' = 'expense_credit' then -(part->>'amount')::numeric else 0 end) cost,
      sum(case when e->>'kind' = 'payment' then (part->>'amount')::numeric when e->>'kind' = 'refund' then -(part->>'amount')::numeric else 0 end) paid
    from parts where coalesce(e->>'balanceImpact','normal') <> 'historical'
    group by e->>'account', part->>'workId', e->>'contractId'
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
    select * from rows order by date desc nulls last, created desc, id desc offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'person', jsonb_build_object('name', v_person->>'name', 'role', coalesce(v_person->>'role','')),
    'projectName', v_doc->'project'->>'name', 'account', v_link.account,
    'workName', coalesce((select w->>'name' from jsonb_array_elements(v_doc->'works') w where w->>'id' = v_link.work_id), ''),
    'updatedAt', v_updated, 'revision', v_revision,
    'total', (select count(*) from rows),
    'nextOffset', case when p_offset + p_limit < (select count(*) from rows) then p_offset + p_limit else null end,
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

revoke all on function public.contact_share_status(text,text,text), public.create_contact_share(text,text,text), public.revoke_contact_share(uuid), public.read_contact_share(text,integer,integer,bigint) from public, anon, authenticated;
grant execute on function public.contact_share_status(text,text,text), public.create_contact_share(text,text,text), public.revoke_contact_share(uuid) to authenticated;
grant execute on function public.read_contact_share(text,integer,integer,bigint) to anon, authenticated;

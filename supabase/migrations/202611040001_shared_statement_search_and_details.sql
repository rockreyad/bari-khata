begin;

create extension if not exists pg_trgm with schema extensions;

create or replace function private.contact_share_context(p_token text, p_revision bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_context jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select jsonb_build_object('ownerId',l.owner_id,'personId',l.person_id,'account',l.account,
    'workId',l.work_id,'revision',d.revision,'document',d.document)
    into v_context
  from public.contact_share_links l join public.ledger_documents d on d.owner_id=l.owner_id
  where l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.revoked_at is null;
  if v_context is null or not exists(
    select 1 from jsonb_array_elements(v_context#>'{document,people}') p
    where p->>'id'=v_context->>'personId'
  ) then return null; end if;
  if p_revision is not null and p_revision<>(v_context->>'revision')::bigint then
    raise exception 'share_changed';
  end if;
  return v_context;
end;
$$;

create or replace function private.contact_share_parts(p_context jsonb)
returns table(entry jsonb,effective_account text,part jsonb,ordinal bigint)
language sql stable set search_path = '' as $$
  with person as (
    select p from jsonb_array_elements(p_context#>'{document,people}') p
    where p->>'id'=p_context->>'personId'
  ), identity as (
    select coalesce(p->>'kind',case
      when concat(p->>'role',' ',p->>'name') ~* 'দোকান|স্টোর|হার্ডওয়্যার|ট্রেড|সাপ্লাই|এন্টারপ্রাইজ|shop|store|trading|enterprise|supplier|hardware' then 'shop'
      when concat(p->>'role',' ',p->>'name') ~* 'চালক|ড্রাইভার|ভ্যান|driver|transport|truck|van' then 'driver'
      else 'other' end)='driver' driver from person
  ), own as (
    select e from jsonb_array_elements(p_context#>'{document,entries}') e
    where e->>'personId'=p_context->>'personId'
  ), transport_bills as (
    select e->>'id' id from own
    where e->>'kind' in ('expense','expense_credit') and jsonb_array_length(e->'lines')>0
      and not exists(select 1 from jsonb_array_elements(e->'lines') l where l->>'costType'<>'transport')
  ), buckets as (
    select e->>'account' account,l->>'workId' work_id,bool_and(l->>'costType'='transport') pure
    from own cross join lateral jsonb_array_elements(e->'lines') l
    where e->>'kind' in ('expense','expense_credit') and not coalesce((e->>'voided')::boolean,false)
      and coalesce(e->>'balanceImpact','normal')<>'historical'
    group by e->>'account',l->>'workId'
  ), classified as (
    select e,case when (select driver from identity) and e->>'account'='materials' and (
      e->>'id' in (select id from transport_bills) or
      (e->>'kind' in ('payment','refund') and (
        e->>'relatedEntryId' in (select id from transport_bills) or
        (e->>'relatedEntryId' is null and jsonb_array_length(e->'allocations')>0 and not exists(
          select 1 from jsonb_array_elements(e->'allocations') a where not exists(
            select 1 from buckets b where b.account=e->>'account' and b.work_id=a->>'workId' and b.pure
          )
        ))
      ))
    ) then 'other' else e->>'account' end effective_account from own
  ), scoped as (
    select e,effective_account from classified
    where not coalesce((e->>'voided')::boolean,false) and (
      (e->>'kind'='adjustment' and effective_account=p_context->>'account') or
      ((not (select driver from identity) or p_context->>'account'<>'other') and effective_account=p_context->>'account') or
      ((select driver from identity) and p_context->>'account'='other' and (
        e->>'id' in (select id from transport_bills) or
        (e->>'kind' in ('payment','refund') and effective_account='other' and
          (e->>'relatedEntryId' is null or e->>'relatedEntryId' in (select id from transport_bills)))
      ))
    )
  )
  select e,effective_account,part,ord from scoped
  cross join lateral jsonb_array_elements(case
    when e->>'kind'='adjustment' then jsonb_build_array(jsonb_build_object('workId',e#>'{adjustment,workId}','label',e->>'note'))
    when e->>'kind' in ('expense','expense_credit') then e->'lines' else e->'allocations' end
  ) with ordinality x(part,ord)
  where p_context->>'workId' is null or part->>'workId'=p_context->>'workId';
$$;

create or replace function private.contact_share_normalize(p_text text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select trim(regexp_replace(translate(lower(normalize(coalesce(p_text,''),NFKC)),
    '০১২৩৪৫৬৭৮৯','0123456789'),'[[:space:]]+',' ','g'));
$$;

create or replace function public.search_contact_share(
  p_token text,p_offset integer default 0,p_limit integer default 20,
  p_revision bigint default null,p_query text default null,p_kind text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_summary jsonb; v_query text; v_page jsonb; v_total integer;
begin
  if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>20 then
    raise exception 'invalid_share_page';
  end if;
  if length(coalesce(p_query,''))>200 then raise exception 'invalid_share_query'; end if;
  if p_kind is not null and p_kind not in ('expense','payment','expense_credit','refund','adjustment') then
    raise exception 'invalid_share_filter';
  end if;
  v_context:=private.contact_share_context(p_token,p_revision);
  if v_context is null then return null; end if;
  v_summary:=public.read_contact_share(p_token,0,20,(v_context->>'revision')::bigint,null);
  if v_summary is null then return null; end if;
  v_query:=private.contact_share_normalize(replace(replace(coalesce(p_query,''),',',''),'৳',''));
  with parts as (
    select *,v_context->>'workId' is null or not exists(
      select 1 from jsonb_array_elements(case when entry->>'kind' in ('expense','expense_credit') then entry->'lines'
        when entry->>'kind'='adjustment' then jsonb_build_array(jsonb_build_object('workId',entry#>'{adjustment,workId}'))
        else entry->'allocations' end) raw_part where raw_part->>'workId' is distinct from v_context->>'workId'
    ) whole_entry from private.contact_share_parts(v_context)
  ), rows as (
    select entry->>'id' id,entry->>'date' date,entry->>'createdAt' created,entry->>'kind' kind,
      coalesce(entry->>'balanceImpact','normal')='historical' historical,
      sum(case when entry->>'kind'='expense' then (part->>'amount')::numeric when entry->>'kind'='expense_credit' then -(part->>'amount')::numeric else 0 end) charge,
      sum(case when entry->>'kind'='payment' then (part->>'amount')::numeric when entry->>'kind'='refund' then -(part->>'amount')::numeric else 0 end) paid,
      sum(case when entry->>'kind'='adjustment' then (entry#>>'{adjustment,delta}')::numeric else 0 end) adjustment,
      max(entry#>>'{adjustment,basis}') adjustment_basis,
      coalesce(string_agg(nullif(part->>'label',''),' · ' order by ordinal),'') description,
      coalesce(string_agg(distinct nullif(w->>'name',''),' · '),'') works,
      max(case when whole_entry then entry->>'note' end) note,max(case when whole_entry then c->>'title' end) title,
      max(case when whole_entry then (select string_agg(case m->>'method'
        when 'cash' then 'cash নগদ' when 'bank' then 'bank ব্যাংক'
        when 'bkash' then 'bkash বিকাশ' else 'other অন্য' end,' ')
        from jsonb_array_elements(entry->'paymentParts') m) end) methods,
      max(case when whole_entry then (select string_agg(r->>'name',' ') from jsonb_array_elements(entry->'receipts') r) end) receipt_names
    from parts left join lateral (
      select w from jsonb_array_elements(v_context#>'{document,works}') w where w->>'id'=part->>'workId'
    ) n on true left join lateral (
      select c from jsonb_array_elements(v_context#>'{document,contracts}') c where c->>'id'=entry->>'contractId'
    ) j on true
    group by entry->>'id',entry->>'date',entry->>'createdAt',entry->>'kind',coalesce(entry->>'balanceImpact','normal')
  ), searchable as (
    select *,private.contact_share_normalize(concat_ws(' ',description,works,note,title,methods,receipt_names,date,
      to_char(date::date,'FMDD FMMonth YYYY'),extract(day from date::date)::text,
      case extract(month from date::date)::integer
        when 1 then 'জানুয়ারি জানুয়ারি' when 2 then 'ফেব্রুয়ারি ফেব্রুয়ারি' when 3 then 'মার্চ' when 4 then 'এপ্রিল'
        when 5 then 'মে' when 6 then 'জুন' when 7 then 'জুলাই' when 8 then 'আগস্ট' when 9 then 'সেপ্টেম্বর'
        when 10 then 'অক্টোবর' when 11 then 'নভেম্বর' when 12 then 'ডিসেম্বর' end,
      case kind when 'expense' then 'বিল মাল কেনা bill purchase'
        when 'payment' then 'পরিশোধ টাকা জমা পেয়েছেন পেয়েছেন paid payment'
        when 'expense_credit' then 'মাল ফেরত return'
        when 'refund' then 'টাকা ফেরত refund'
        when 'adjustment' then 'সমন্বয় সমন্বয় adjustment' end,
      (charge/100)::text,(paid/100)::text,(adjustment/100)::text)) search_text
    from rows
  ), matches as (
    select * from searchable where (p_kind is null or kind=p_kind) and (v_query='' or not exists(
      select 1 from regexp_split_to_table(v_query,' ') term
      where strpos(search_text,term)=0 and (length(term)<3 or term ~ '[0-9./_-]' or extensions.word_similarity(term,search_text)<0.45)
    ))
  ), page as (
    select * from matches order by date desc nulls last,created desc,id desc offset p_offset limit p_limit
  )
  select (select count(*) from matches),coalesce((select jsonb_agg(jsonb_build_object(
    'key',id,'date',date,'kind',kind,'historical',historical,'charge',charge,'paid',paid,
    'adjustment',adjustment,'adjustmentBasis',adjustment_basis,'description',description,'works',works
  ) order by date desc nulls last,created desc,id desc) from page),'[]'::jsonb) into v_total,v_page;
  return v_summary||jsonb_build_object('total',v_total,'rows',v_page,
    'nextOffset',case when p_offset+jsonb_array_length(v_page)<v_total then p_offset+jsonb_array_length(v_page) else null end);
end;
$$;

create or replace function public.read_contact_share_entry(p_token text,p_entry_id text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_entry jsonb; v_result jsonb; v_whole boolean;
begin
  if p_revision is null or p_revision<1 then return null; end if;
  v_context:=private.contact_share_context(p_token,p_revision);
  if v_context is null then return null; end if;
  select entry into v_entry from private.contact_share_parts(v_context) where entry->>'id'=p_entry_id limit 1;
  if v_entry is null then return null; end if;
  v_whole:=v_context->>'workId' is null or not exists(
    select 1 from jsonb_array_elements(case when v_entry->>'kind' in ('expense','expense_credit') then v_entry->'lines'
      when v_entry->>'kind'='adjustment' then jsonb_build_array(jsonb_build_object('workId',v_entry#>'{adjustment,workId}'))
      else v_entry->'allocations' end) p where p->>'workId' is distinct from v_context->>'workId'
  );
  select jsonb_build_object(
    'revision',(v_context->>'revision')::bigint,'key',v_entry->>'id','date',v_entry->'date','kind',v_entry->>'kind',
    'historical',coalesce(v_entry->>'balanceImpact','normal')='historical',
    'charge',sum(case when v_entry->>'kind'='expense' then (part->>'amount')::numeric when v_entry->>'kind'='expense_credit' then -(part->>'amount')::numeric else 0 end),
    'paid',sum(case when v_entry->>'kind'='payment' then (part->>'amount')::numeric when v_entry->>'kind'='refund' then -(part->>'amount')::numeric else 0 end),
    'adjustment',sum(case when v_entry->>'kind'='adjustment' then (v_entry#>>'{adjustment,delta}')::numeric else 0 end),
    'adjustmentBasis',v_entry#>'{adjustment,basis}',
    'description',coalesce(string_agg(nullif(part->>'label',''),' · ' order by ordinal),''),
    'works',coalesce(string_agg(distinct nullif(w->>'name',''),' · '),''),'note',case when v_whole then coalesce(v_entry->>'note','') else '' end,
    'lines',coalesce(jsonb_agg(jsonb_build_object('label',coalesce(part->>'label',''),'amount',(part->>'amount')::numeric,'workName',coalesce(w->>'name','')) order by ordinal)
      filter(where v_entry->>'kind' in ('expense','expense_credit')),'[]'::jsonb),
    'paymentParts',case when v_whole then coalesce((select jsonb_agg(jsonb_build_object('method',m->>'method','amount',(m->>'amount')::numeric)) from jsonb_array_elements(v_entry->'paymentParts') m),'[]'::jsonb) else '[]'::jsonb end,
    'paymentMethods',case when v_whole then coalesce((select jsonb_agg(distinct m->>'method') from jsonb_array_elements(v_entry->'paymentParts') m),'[]'::jsonb) else '[]'::jsonb end,
    'receipts',case when v_whole then coalesce((select jsonb_agg(jsonb_build_object('id',r->>'id','name',r->>'name','mime',r->>'mime','size',(r->>'size')::numeric)) from jsonb_array_elements(v_entry->'receipts') r),'[]'::jsonb) else '[]'::jsonb end
  ) into v_result
  from private.contact_share_parts(v_context) left join lateral (
    select w from jsonb_array_elements(v_context#>'{document,works}') w where w->>'id'=part->>'workId'
  ) n on true where entry->>'id'=p_entry_id;
  return v_result;
end;
$$;

create or replace function public.contact_share_receipt_authorization(p_token text,p_entry_id text,p_receipt_id text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_detail jsonb; v_receipt jsonb;
begin
  if p_revision is null or p_revision<1 then return null; end if;
  if p_receipt_id is null or length(p_receipt_id)>200 or p_receipt_id in ('','.','..')
    or position('/' in p_receipt_id)>0 or position(chr(92) in p_receipt_id)>0
    or p_receipt_id ~ '[[:cntrl:]]' then return null; end if;
  v_context:=private.contact_share_context(p_token,p_revision);
  if v_context is null then return null; end if;
  v_detail:=public.read_contact_share_entry(p_token,p_entry_id,(v_context->>'revision')::bigint);
  if v_detail is null then return null; end if;
  select r into v_receipt from jsonb_array_elements(v_detail->'receipts') r where r->>'id'=p_receipt_id;
  if v_receipt is null then return null; end if;
  return v_receipt||jsonb_build_object('storagePath',(v_context->>'ownerId')||'/'||p_receipt_id);
end;
$$;

revoke all on function private.contact_share_context(text,bigint),private.contact_share_parts(jsonb),private.contact_share_normalize(text) from public,anon,authenticated,service_role;
revoke all on function public.search_contact_share(text,integer,integer,bigint,text,text),public.read_contact_share_entry(text,text,bigint),public.contact_share_receipt_authorization(text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.search_contact_share(text,integer,integer,bigint,text,text),public.read_contact_share_entry(text,text,bigint) to anon,authenticated;
grant execute on function public.contact_share_receipt_authorization(text,text,text,bigint) to service_role;

notify pgrst,'reload schema';

commit;

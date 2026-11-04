begin;

create or replace function private.contact_share_rows(p_context jsonb)
returns table(id text,date text,created text,kind text,historical boolean,charge numeric,paid numeric,
  adjustment numeric,adjustment_basis text,description text,works text,note text,title text,
  methods text,receipt_names text,related_id text,whole_entry boolean)
language sql stable set search_path = '' as $$
  with parts as (
    select *,p_context->>'workId' is null or not exists(
      select 1 from jsonb_array_elements(case when entry->>'kind' in ('expense','expense_credit') then entry->'lines'
        when entry->>'kind'='adjustment' then jsonb_build_array(jsonb_build_object('workId',entry#>'{adjustment,workId}'))
        else entry->'allocations' end) raw_part where raw_part->>'workId' is distinct from p_context->>'workId'
    ) whole from private.contact_share_parts(p_context)
  )
  select entry->>'id',entry->>'date',entry->>'createdAt',entry->>'kind',
    coalesce(entry->>'balanceImpact','normal')='historical',
    sum(case when entry->>'kind'='expense' then (part->>'amount')::numeric when entry->>'kind'='expense_credit' then -(part->>'amount')::numeric else 0 end),
    sum(case when entry->>'kind'='payment' then (part->>'amount')::numeric when entry->>'kind'='refund' then -(part->>'amount')::numeric else 0 end),
    sum(case when entry->>'kind'='adjustment' then (entry#>>'{adjustment,delta}')::numeric else 0 end),
    max(entry#>>'{adjustment,basis}'),
    coalesce(nullif(string_agg(nullif(btrim(coalesce(nullif(part->>'label',''),i->>'name','')),''),' · ' order by ordinal),''),
      max(case when whole and entry->>'kind' in ('payment','refund') then c->>'title' end),''),
    coalesce(string_agg(distinct nullif(w->>'name',''),' · '),''),
    max(case when whole then entry->>'note' end),max(case when whole then c->>'title' end),
    max(case when whole then (select string_agg(case m->>'method'
      when 'cash' then 'cash নগদ' when 'bank' then 'bank ব্যাংক'
      when 'bkash' then 'bkash বিকাশ' else 'other অন্য' end,' ')
      from jsonb_array_elements(entry->'paymentParts') m) end),
    max(case when whole then (select string_agg(r->>'name',' ') from jsonb_array_elements(entry->'receipts') r) end),
    max(entry->>'relatedEntryId'),bool_and(whole)
  from parts left join lateral (
    select w from jsonb_array_elements(p_context#>'{document,works}') w where w->>'id'=part->>'workId'
  ) n on true left join lateral (
    select i from jsonb_array_elements(p_context#>'{document,items}') i where i->>'id'=part->>'itemId'
  ) item on true left join lateral (
    select c from jsonb_array_elements(p_context#>'{document,contracts}') c where c->>'id'=entry->>'contractId'
  ) j on true
  group by entry->>'id',entry->>'date',entry->>'createdAt',entry->>'kind',coalesce(entry->>'balanceImpact','normal');
$$;

create or replace function private.contact_share_row_search(p_row jsonb)
returns text language sql immutable set search_path = '' as $$
  select private.contact_share_normalize(concat_ws(' ',p_row->>'description',p_row->>'works',p_row->>'note',p_row->>'title',
    p_row->>'methods',p_row->>'receipt_names',p_row->>'date',to_char((p_row->>'date')::date,'FMDD FMMonth YYYY'),
    extract(day from (p_row->>'date')::date)::text,
    case extract(month from (p_row->>'date')::date)::integer
      when 1 then 'জানুয়ারি জানুয়ারি' when 2 then 'ফেব্রুয়ারি ফেব্রুয়ারি' when 3 then 'মার্চ' when 4 then 'এপ্রিল'
      when 5 then 'মে' when 6 then 'জুন' when 7 then 'জুলাই' when 8 then 'আগস্ট' when 9 then 'সেপ্টেম্বর'
      when 10 then 'অক্টোবর' when 11 then 'নভেম্বর' when 12 then 'ডিসেম্বর' end,
    case p_row->>'kind' when 'expense' then 'বিল মাল কেনা bill purchase'
      when 'payment' then 'পরিশোধ টাকা জমা পেয়েছেন পেয়েছেন paid payment'
      when 'expense_credit' then 'মাল ফেরত return' when 'refund' then 'টাকা ফেরত refund'
      when 'adjustment' then 'সমন্বয় সমন্বয় adjustment' end,
    ((p_row->>'charge')::numeric/100)::text,((p_row->>'paid')::numeric/100)::text,((p_row->>'adjustment')::numeric/100)::text));
$$;

create or replace function private.contact_share_settlement(p_context jsonb,p_entry_id text)
returns jsonb language sql stable set search_path = '' as $$
  with rows as materialized (select * from private.contact_share_rows(p_context)),
  bill as (select * from rows where id=p_entry_id and kind='expense' and not historical),
  totals as (
    select coalesce(sum(p.paid) filter(where p.kind='payment'),0) paid,
      coalesce(-sum(p.charge) filter(where p.kind='expense_credit'),0) returned,
      coalesce(-sum(p.paid) filter(where p.kind='refund'),0) refunded,
      count(*) filter(where p.kind='payment') payment_count
    from rows p where p.related_id=p_entry_id and not p.historical
  )
  select jsonb_build_object('paid',totals.paid,'returned',returned,'refunded',refunded,
    'balance',bill.charge-returned-totals.paid+refunded,'paymentCount',payment_count)
  from bill cross join totals;
$$;

create or replace function public.read_contact_share_activity(
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
  with rows as materialized (select * from private.contact_share_rows(v_context)),
  grouped as (
    select r.*,case when r.kind='expense' and not r.historical then jsonb_build_object(
      'paid',coalesce(s.paid,0),'returned',coalesce(s.returned,0),'refunded',coalesce(s.refunded,0),
      'balance',r.charge-coalesce(s.returned,0)-coalesce(s.paid,0)+coalesce(s.refunded,0),
      'paymentCount',coalesce(s.payment_count,0)) end settlement,
      private.contact_share_row_search(to_jsonb(r))||' '||coalesce(s.search_text,'') search_text
    from rows r left join lateral (
      select sum(p.paid) filter(where p.kind='payment') paid,
        -sum(p.charge) filter(where p.kind='expense_credit') returned,
        -sum(p.paid) filter(where p.kind='refund') refunded,
        count(*) filter(where p.kind='payment') payment_count,
        string_agg(private.contact_share_row_search(to_jsonb(p)),' ') search_text
      from rows p where p.related_id=r.id and not p.historical
    ) s on r.kind='expense' and not r.historical
    where not (r.kind='payment' and not r.historical and exists(
      select 1 from rows bill where bill.id=r.related_id and bill.kind='expense' and not bill.historical
    ))
  ), matches as (
    select * from grouped where (p_kind is null or kind=p_kind) and (v_query='' or not exists(
      select 1 from regexp_split_to_table(v_query,' ') term
      where strpos(search_text,term)=0 and (length(term)<3 or term ~ '[0-9./_-]' or extensions.word_similarity(term,search_text)<0.45)
    ))
  ), page as (
    select * from matches order by date desc nulls last,created desc,id desc offset p_offset limit p_limit
  )
  select (select count(*) from matches),coalesce((select jsonb_agg(jsonb_build_object(
    'key',id,'date',date,'kind',kind,'historical',historical,'charge',charge,'paid',paid,
    'adjustment',adjustment,'adjustmentBasis',adjustment_basis,'description',description,'works',works
  )||case when settlement is null then '{}'::jsonb else jsonb_build_object('settlement',settlement) end
    order by date desc nulls last,created desc,id desc) from page),'[]'::jsonb) into v_total,v_page;
  return v_summary||jsonb_build_object('total',v_total,'rows',v_page,
    'nextOffset',case when p_offset+jsonb_array_length(v_page)<v_total then p_offset+jsonb_array_length(v_page) else null end);
end;
$$;

create or replace function private.contact_share_entry_data(p_context jsonb,p_entry_id text)
returns jsonb language sql stable set search_path = '' as $$
  with selected as (
    select r.*,entry from private.contact_share_rows(p_context) r join lateral (
      select entry from private.contact_share_parts(p_context) where entry->>'id'=r.id limit 1
    ) e on true where r.id=p_entry_id
  )
  select jsonb_build_object(
    'revision',(p_context->>'revision')::bigint,'key',id,'date',date,'kind',kind,'historical',historical,
    'charge',charge,'paid',paid,'adjustment',adjustment,'adjustmentBasis',adjustment_basis,
    'description',description,'works',works,'note',coalesce(note,''),
    'lines',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'label',coalesce(nullif(part->>'label',''),i->>'name',''),'amount',(part->>'amount')::numeric,
      'workName',coalesce(w->>'name',''),
      'quantity',case when translate(part->>'quantity','০১২৩৪৫৬৭৮৯','0123456789') ~ '^\d+(\.\d{1,4})?$'
        then case when translate(part->>'quantity','০১২৩৪৫৬৭৮৯','0123456789')::numeric>0 and
          translate(part->>'quantity','০১২৩৪৫৬৭৮৯','0123456789')::numeric<=9007199254740991
          then translate(part->>'quantity','০১২৩৪৫৬৭৮৯','0123456789')::numeric end end,
      'unit',nullif(part->>'unit',''))) order by ordinal)
      from private.contact_share_parts(p_context) p left join lateral (
        select w from jsonb_array_elements(p_context#>'{document,works}') w where w->>'id'=part->>'workId'
      ) n on true left join lateral (
        select i from jsonb_array_elements(p_context#>'{document,items}') i where i->>'id'=part->>'itemId'
      ) item on true where p.entry->>'id'=id and kind in ('expense','expense_credit')),'[]'::jsonb),
    'paymentParts',case when whole_entry then coalesce((select jsonb_agg(jsonb_build_object('method',m->>'method','amount',(m->>'amount')::numeric)) from jsonb_array_elements(entry->'paymentParts') m),'[]'::jsonb) else '[]'::jsonb end,
    'paymentMethods',case when whole_entry then coalesce((select jsonb_agg(distinct m->>'method') from jsonb_array_elements(entry->'paymentParts') m),'[]'::jsonb) else '[]'::jsonb end,
    'receipts',case when whole_entry then coalesce((select jsonb_agg(jsonb_build_object('id',r->>'id','name',r->>'name','mime',r->>'mime','size',(r->>'size')::numeric)) from jsonb_array_elements(entry->'receipts') r),'[]'::jsonb) else '[]'::jsonb end
  ) from selected;
$$;

create or replace function public.read_contact_share_entry(p_token text,p_entry_id text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_result jsonb; v_bill jsonb; v_related text; v_payments jsonb; v_settlement jsonb;
begin
  if p_revision is null or p_revision<1 then return null; end if;
  v_context:=private.contact_share_context(p_token,p_revision);
  if v_context is null then return null; end if;
  v_result:=private.contact_share_entry_data(v_context,p_entry_id);
  if v_result is null then return null; end if;
  if v_result->>'kind'='expense' and not (v_result->>'historical')::boolean then
    v_settlement:=private.contact_share_settlement(v_context,p_entry_id);
    select coalesce(jsonb_agg(jsonb_build_object('key',p.id,'date',p.date,'paid',p.paid,'description',p.description,
      'paymentParts',d->'paymentParts','paymentMethods',d->'paymentMethods') order by p.date desc nulls last,p.created desc,p.id desc),'[]'::jsonb)
      into v_payments from private.contact_share_rows(v_context) p cross join lateral (
        select private.contact_share_entry_data(v_context,p.id) d
      ) detail where p.related_id=p_entry_id and p.kind='payment' and not p.historical;
    v_result:=v_result||jsonb_build_object('settlement',v_settlement,'payments',v_payments);
  elsif v_result->>'kind'='payment' then
    select related_id into v_related from private.contact_share_rows(v_context) where id=p_entry_id;
    v_bill:=private.contact_share_entry_data(v_context,v_related);
    if v_bill->>'kind'='expense' then
      v_result:=v_result||jsonb_build_object('relatedBill',jsonb_build_object(
        'key',v_bill->'key','date',v_bill->'date','charge',v_bill->'charge','lines',v_bill->'lines'));
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function private.contact_share_rows(jsonb),private.contact_share_row_search(jsonb),
  private.contact_share_settlement(jsonb,text),private.contact_share_entry_data(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.read_contact_share_activity(text,integer,integer,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.read_contact_share_activity(text,integer,integer,bigint,text,text) to anon,authenticated;
notify pgrst,'reload schema';

commit;

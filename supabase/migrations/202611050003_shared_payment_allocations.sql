begin;

create or replace function private.contact_share_bill_payments(p_context jsonb)
returns table(bill_id text,payment_id text,amount numeric)
language sql stable set search_path = '' as $$
  with rows as materialized (select * from private.contact_share_rows(p_context)),
  raw as materialized (select e from jsonb_array_elements(p_context#>'{document,entries}') e),
  allocations as materialized (
    select a from jsonb_array_elements(coalesce(p_context#>'{document,paymentAllocations}','[]'::jsonb)) a
    where not(a ? 'cancelledAt')
  ), explicit as (
    select b.id bill_id,p.id payment_id,(a->>'amount')::numeric amount
    from allocations join rows b on b.id=a->>'billId' and b.kind='expense' and not b.historical
    join rows p on p.id=a->>'paymentId' and p.kind='payment' and not p.historical
    join raw bill on bill.e->>'id'=b.id
    where p_context->>'workId' is null or coalesce(a->>'workId',bill.e#>>'{lines,0,workId}')=p_context->>'workId'
  ), legacy as (
    select b.id bill_id,p.id payment_id,p.paid amount
    from rows p join rows b on b.id=p.related_id and b.kind='expense' and not b.historical
    join raw cash on cash.e->>'id'=p.id
    where p.kind='payment' and not p.historical and coalesce(cash.e->>'paymentContext','')<>'receivable'
      and not exists(select 1 from allocations where a->>'paymentId'=p.id)
  )
  select bill_id,payment_id,sum(amount) from (select * from explicit union all select * from legacy) payments
  group by bill_id,payment_id;
$$;

create or replace function private.contact_share_settlement(p_context jsonb,p_entry_id text)
returns jsonb language sql stable set search_path = '' as $$
  with rows as materialized (select * from private.contact_share_rows(p_context)),
  bill as (select * from rows where id=p_entry_id and kind='expense' and not historical),
  paid as (
    select coalesce(sum(amount),0) amount,count(*) payment_count
    from private.contact_share_bill_payments(p_context) where bill_id=p_entry_id
  ), returns as (
    select coalesce(-sum(p.charge) filter(where p.kind='expense_credit'),0) returned,
      coalesce(-sum(p.paid) filter(where p.kind='refund' and coalesce(e->>'paymentContext','')<>'receivable'),0) refunded
    from rows p join jsonb_array_elements(p_context#>'{document,entries}') e on e->>'id'=p.id
    where p.related_id=p_entry_id and not p.historical
  )
  select jsonb_build_object('paid',paid.amount,'returned',returned,'refunded',refunded,
    'balance',bill.charge-returned-paid.amount+refunded,'paymentCount',payment_count)
  from bill cross join paid cross join returns;
$$;

create or replace function private.contact_share_payment_page(p_context jsonb,p_entry_id text,p_offset integer,p_limit integer)
returns jsonb language sql stable set search_path = '' as $$
  with rows as materialized (select * from private.contact_share_rows(p_context)),
  bill as (select id from rows where id=p_entry_id and kind='expense' and not historical),
  payments as materialized (
    select r.*,link.amount allocated_paid from rows r
    join private.contact_share_bill_payments(p_context) link on link.payment_id=r.id
    join bill on link.bill_id=bill.id
    where r.kind='payment' and not r.historical
  ), page as materialized (
    select * from payments order by date desc nulls last,created desc,id desc offset p_offset limit p_limit
  ), raw as materialized (
    select e from jsonb_array_elements(p_context#>'{document,entries}') e
    where e->>'personId'=p_context->>'personId' and e->>'id' in (select id from page)
  ), details as (
    select p.*,jsonb_build_object('key',p.id,'date',p.date,'paid',p.allocated_paid,'description',p.description,
      'paymentParts',case when p.whole_entry and p.allocated_paid=p.paid then coalesce((
        select jsonb_agg(jsonb_build_object('method',m->>'method','amount',(m->>'amount')::numeric))
        from jsonb_array_elements(e->'paymentParts') m),'[]'::jsonb) else '[]'::jsonb end,
      'paymentMethods',case when p.whole_entry then coalesce((
        select jsonb_agg(distinct m->>'method') from jsonb_array_elements(e->'paymentParts') m),'[]'::jsonb) else '[]'::jsonb end
    ) detail from page p join raw on e->>'id'=p.id
  ), result as (select count(*) total from payments)
  select jsonb_build_object('revision',(p_context->>'revision')::bigint,'key',p_entry_id,
    'total',total,'nextOffset',case when p_offset+p_limit<total then p_offset+p_limit else null end,
    'payments',coalesce((select jsonb_agg(detail order by date desc nulls last,created desc,id desc) from details),'[]'::jsonb))
  from result where exists(select 1 from bill);
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
  links as materialized (select * from private.contact_share_bill_payments(v_context)),
  relations as (
    select l.bill_id related_id,l.amount paid,0::numeric returned,0::numeric refunded,1 payment_count,
      case when v_query<>'' then private.contact_share_row_search(to_jsonb(p)) end search_text
    from links l join rows p on p.id=l.payment_id
    union all
    select p.related_id,0::numeric,
      case when p.kind='expense_credit' then -p.charge else 0 end,
      case when p.kind='refund' then -p.paid else 0 end,0,
      case when v_query<>'' then private.contact_share_row_search(to_jsonb(p)) end
    from rows p join jsonb_array_elements(v_context#>'{document,entries}') e on e->>'id'=p.id
    where p.related_id is not null and not p.historical and p.kind in ('expense_credit','refund')
      and (p.kind<>'refund' or coalesce(e->>'paymentContext','')<>'receivable')
  ), related as (
    select related_id,sum(paid) paid,sum(returned) returned,sum(refunded) refunded,sum(payment_count) payment_count,
      case when v_query<>'' then string_agg(search_text,' ') end search_text
    from relations group by related_id
  ), hidden as (select payment_id,sum(amount) amount from links group by payment_id),
  grouped as (
    select r.*,case when r.kind='expense' and not r.historical then jsonb_build_object(
      'paid',coalesce(s.paid,0),'returned',coalesce(s.returned,0),'refunded',coalesce(s.refunded,0),
      'balance',r.charge-coalesce(s.returned,0)-coalesce(s.paid,0)+coalesce(s.refunded,0),
      'paymentCount',coalesce(s.payment_count,0)) end settlement,
      case when v_query<>'' then private.contact_share_row_search(to_jsonb(r))||' '||coalesce(s.search_text,'') end search_text
    from rows r left join related s on s.related_id=r.id and r.kind='expense' and not r.historical
    left join hidden h on h.payment_id=r.id
    where not(r.kind='payment' and not r.historical and coalesce(h.amount,0)>=r.paid and r.paid>0)
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

create or replace function public.read_contact_share_entry(p_token text,p_entry_id text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_result jsonb; v_bill jsonb; v_related text; v_page jsonb; v_settlement jsonb;
begin
  if p_revision is null or p_revision<1 then return null; end if;
  if p_entry_id is null or length(p_entry_id) not between 1 and 160 then return null; end if;
  v_context:=private.contact_share_context(p_token,p_revision);
  if v_context is null then return null; end if;
  v_result:=private.contact_share_entry_data(v_context,p_entry_id);
  if v_result is null then return null; end if;
  if v_result->>'kind'='expense' and not (v_result->>'historical')::boolean then
    v_settlement:=private.contact_share_settlement(v_context,p_entry_id);
    v_page:=private.contact_share_payment_page(v_context,p_entry_id,0,20);
    v_result:=v_result||jsonb_build_object('settlement',v_settlement,'payments',v_page->'payments',
      'paymentsTotal',v_page->'total','paymentsNextOffset',v_page->'nextOffset');
  elsif v_result->>'kind'='payment' then
    select case when count(*)=1 then min(bill_id) end into v_related
    from private.contact_share_bill_payments(v_context) where payment_id=p_entry_id;
    v_bill:=private.contact_share_entry_data(v_context,v_related);
    if v_bill->>'kind'='expense' then
      v_result:=v_result||jsonb_build_object('relatedBill',jsonb_build_object(
        'key',v_bill->'key','date',v_bill->'date','charge',v_bill->'charge','lines',v_bill->'lines'));
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function private.contact_share_bill_payments(jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;

begin;

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
  related as (
    select related_id,
      sum(paid) filter(where kind='payment') paid,
      -sum(charge) filter(where kind='expense_credit') returned,
      -sum(paid) filter(where kind='refund') refunded,
      count(*) filter(where kind='payment') payment_count,
      case when v_query<>'' then string_agg(private.contact_share_row_search(to_jsonb(p)),' ') end search_text
    from rows p where related_id is not null and not historical group by related_id
  ), grouped as (
    select r.*,case when r.kind='expense' and not r.historical then jsonb_build_object(
      'paid',coalesce(s.paid,0),'returned',coalesce(s.returned,0),'refunded',coalesce(s.refunded,0),
      'balance',r.charge-coalesce(s.returned,0)-coalesce(s.paid,0)+coalesce(s.refunded,0),
      'paymentCount',coalesce(s.payment_count,0)) end settlement,
      case when v_query<>'' then private.contact_share_row_search(to_jsonb(r))||' '||coalesce(s.search_text,'') end search_text
    from rows r left join related s on s.related_id=r.id and r.kind='expense' and not r.historical
    left join rows bill on bill.id=r.related_id and bill.kind='expense' and not bill.historical
    where not (r.kind='payment' and not r.historical and bill.id is not null)
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

create function private.contact_share_payment_page(p_context jsonb,p_entry_id text,p_offset integer,p_limit integer)
returns jsonb language sql stable set search_path = '' as $$
  with rows as materialized (select * from private.contact_share_rows(p_context)),
  bill as (select id from rows where id=p_entry_id and kind='expense' and not historical),
  payments as materialized (
    select r.* from rows r join bill on r.related_id=bill.id
    where r.kind='payment' and not r.historical
  ), page as materialized (
    select * from payments order by date desc nulls last,created desc,id desc offset p_offset limit p_limit
  ), raw as materialized (
    select e from jsonb_array_elements(p_context#>'{document,entries}') e
    where e->>'personId'=p_context->>'personId' and e->>'relatedEntryId'=p_entry_id and e->>'kind'='payment'
  ), details as (
    select p.*,jsonb_build_object('key',p.id,'date',p.date,'paid',p.paid,'description',p.description,
      'paymentParts',case when p.whole_entry then coalesce((
        select jsonb_agg(jsonb_build_object('method',m->>'method','amount',(m->>'amount')::numeric))
        from jsonb_array_elements(e->'paymentParts') m),'[]'::jsonb) else '[]'::jsonb end,
      'paymentMethods',case when p.whole_entry then coalesce((
        select jsonb_agg(distinct m->>'method') from jsonb_array_elements(e->'paymentParts') m),'[]'::jsonb) else '[]'::jsonb end
    ) detail from page p join raw on e->>'id'=p.id
  ), result as (
    select count(*) total from payments
  )
  select jsonb_build_object('revision',(p_context->>'revision')::bigint,'key',p_entry_id,
    'total',total,'nextOffset',case when p_offset+p_limit<total then p_offset+p_limit else null end,
    'payments',coalesce((select jsonb_agg(detail order by date desc nulls last,created desc,id desc) from details),'[]'::jsonb))
  from result where exists(select 1 from bill);
$$;

create function public.read_contact_share_payments(
  p_token text,p_entry_id text,p_revision bigint,p_offset integer default 0,p_limit integer default 20
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb;
begin
  if p_revision is null or p_revision<1 then return null; end if;
  if p_offset is null or p_offset<0 or p_offset>100000 or p_limit is null or p_limit<1 or p_limit>20 then
    raise exception 'invalid_share_page';
  end if;
  if p_entry_id is null or length(p_entry_id) not between 1 and 160 then return null; end if;
  v_context:=private.contact_share_context(p_token,p_revision);
  if v_context is null then return null; end if;
  return private.contact_share_payment_page(v_context,p_entry_id,p_offset,p_limit);
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
    select e->>'relatedEntryId' into v_related from jsonb_array_elements(v_context#>'{document,entries}') e where e->>'id'=p_entry_id;
    v_bill:=private.contact_share_entry_data(v_context,v_related);
    if v_bill->>'kind'='expense' then
      v_result:=v_result||jsonb_build_object('relatedBill',jsonb_build_object(
        'key',v_bill->'key','date',v_bill->'date','charge',v_bill->'charge','lines',v_bill->'lines'));
    end if;
  end if;
  return v_result;
end;
$$;

create or replace function public.contact_share_receipt_authorization(p_token text,p_entry_id text,p_receipt_id text,p_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_context jsonb; v_entry jsonb; v_receipt jsonb;
begin
  if p_revision is null or p_revision<1 then return null; end if;
  if p_receipt_id is null or length(p_receipt_id)>200 or p_receipt_id in ('','.','..')
    or position('/' in p_receipt_id)>0 or position(chr(92) in p_receipt_id)>0
    or p_receipt_id ~ '[[:cntrl:]]' then return null; end if;
  v_context:=private.contact_share_context(p_token,p_revision);
  if v_context is null then return null; end if;
  select entry into v_entry from private.contact_share_parts(v_context) where entry->>'id'=p_entry_id limit 1;
  if v_entry is null then return null; end if;
  if v_context->>'workId' is not null and exists(
    select 1 from jsonb_array_elements(case when v_entry->>'kind' in ('expense','expense_credit') then v_entry->'lines'
      when v_entry->>'kind'='adjustment' then jsonb_build_array(jsonb_build_object('workId',v_entry#>'{adjustment,workId}'))
      else v_entry->'allocations' end) p where p->>'workId' is distinct from v_context->>'workId'
  ) then return null; end if;
  select r into v_receipt from jsonb_array_elements(v_entry->'receipts') r where r->>'id'=p_receipt_id;
  if v_receipt is null then return null; end if;
  return jsonb_build_object('id',v_receipt->>'id','name',v_receipt->>'name','mime',v_receipt->>'mime',
    'size',(v_receipt->>'size')::numeric,'storagePath',(v_context->>'ownerId')||'/'||p_receipt_id);
end;
$$;

revoke all on function private.contact_share_payment_page(jsonb,text,integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.read_contact_share_payments(text,text,bigint,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.read_contact_share_payments(text,text,bigint,integer,integer) to anon,authenticated;
notify pgrst,'reload schema';

commit;

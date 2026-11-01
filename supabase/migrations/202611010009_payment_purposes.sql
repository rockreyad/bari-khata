create function public.ledger_payment_purposes_are_valid(p_document jsonb)
returns boolean language plpgsql immutable set search_path=pg_catalog,pg_temp as $$
declare
  v_purposes jsonb := coalesce(p_document->'paymentPurposes','[]'::jsonb);
  v_purpose jsonb;
  v_entry jsonb;
begin
  if jsonb_typeof(v_purposes) is distinct from 'array' or jsonb_array_length(v_purposes)>1000 then return false; end if;
  if (select count(*)<>count(distinct value->>'id') from jsonb_array_elements(v_purposes)) then return false; end if;
  for v_purpose in select value from jsonb_array_elements(v_purposes) loop
    if jsonb_typeof(v_purpose->'id') is distinct from 'string' or length(v_purpose->>'id') not between 1 and 160 or jsonb_typeof(v_purpose->'name') is distinct from 'string' or length(trim(v_purpose->>'name')) not between 1 and 200 or jsonb_typeof(v_purpose->'account') is distinct from 'string' or v_purpose->>'account' not in ('materials','labour','other') then return false; end if;
  end loop;
  for v_entry in
    select value from jsonb_array_elements(p_document->'entries')
    union all
    select revision->'before' from jsonb_array_elements(p_document->'entries') as entry, jsonb_array_elements(coalesce(entry->'revisions','[]'::jsonb)) as revision
  loop
    if v_entry ? 'paymentPurposeId' and v_entry->'paymentPurposeId' <> 'null'::jsonb then
      if jsonb_typeof(v_entry->'paymentPurposeId') is distinct from 'string' or v_entry->>'kind' not in ('payment','refund') or not exists(select 1 from jsonb_array_elements(v_purposes) where value->>'id'=v_entry->>'paymentPurposeId' and value->>'account'=v_entry->>'account') then return false; end if;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;
alter table public.ledger_documents add constraint ledger_payment_purposes_valid check(public.ledger_payment_purposes_are_valid(document));

create function public.preserve_ledger_payment_purposes()
returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
declare
  v_previous jsonb;
  v_next jsonb;
begin
  for v_previous in select value from jsonb_array_elements(coalesce(old.document->'paymentPurposes','[]'::jsonb)) loop
    if not exists(select 1 from jsonb_array_elements(coalesce(new.document->'paymentPurposes','[]'::jsonb)) where value->>'id'=v_previous->>'id' and value->>'account'=v_previous->>'account') then raise exception 'ledger_payment_purpose_would_be_lost'; end if;
  end loop;
  for v_previous in select value from jsonb_array_elements(old.document->'entries') loop
    if v_previous->>'paymentPurposeId' is not null then
      select value into v_next from jsonb_array_elements(new.document->'entries') where value->>'id'=v_previous->>'id';
      if v_next is null or not(v_next ? 'paymentPurposeId') then raise exception 'ledger_payment_purpose_would_be_lost'; end if;
    end if;
  end loop;
  return new;
end;
$$;
create trigger ledger_preserve_payment_purposes before update of document on public.ledger_documents for each row execute function public.preserve_ledger_payment_purposes();
revoke all on function public.ledger_payment_purposes_are_valid(jsonb) from public,anon,authenticated;
revoke all on function public.preserve_ledger_payment_purposes() from public,anon,authenticated;

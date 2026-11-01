create schema if not exists private;

create table private.manual_phone_login_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  attempts integer not null check (attempts > 0),
  expires_at timestamptz not null
);
create index manual_phone_login_buckets_expiry on private.manual_phone_login_buckets(expires_at);
alter table private.manual_phone_login_buckets enable row level security;
revoke all on private.manual_phone_login_buckets from public, anon, authenticated;

create function public.consume_manual_phone_login_attempt(p_phone_key text, p_ip_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_bucket record;
  v_row private.manual_phone_login_buckets;
  v_retry integer := 0;
begin
  if p_phone_key is null or p_phone_key !~ '^[0-9a-f]{64}$'
    or p_ip_key is null or p_ip_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_rate_key';
  end if;

  for v_bucket in
    select * from (values
      ('ip:' || p_ip_key, 30, interval '5 minutes'),
      ('phone:' || p_phone_key, 5, interval '15 minutes')
    ) as buckets(bucket_key, attempt_limit, window_length)
    order by bucket_key
  loop
    insert into private.manual_phone_login_buckets as stored (
      bucket_key, window_started_at, attempts, expires_at
    ) values (
      v_bucket.bucket_key, v_now, 1, v_now + v_bucket.window_length
    )
    on conflict (bucket_key) do update set
      window_started_at = case when stored.expires_at <= v_now then v_now else stored.window_started_at end,
      attempts = case when stored.expires_at <= v_now then 1 else least(stored.attempts + 1, 1000000) end,
      expires_at = case when stored.expires_at <= v_now then v_now + v_bucket.window_length else stored.expires_at end
    returning * into v_row;

    if v_row.attempts > v_bucket.attempt_limit then
      v_retry := least(900, greatest(v_retry, ceil(extract(epoch from v_row.expires_at - v_now))::integer));
      if v_bucket.bucket_key like 'ip:%' then
        return pg_catalog.jsonb_build_object('allowed', false, 'retryAfter', v_retry);
      end if;
    end if;
  end loop;

  delete from private.manual_phone_login_buckets
    where bucket_key in (
      select bucket_key from private.manual_phone_login_buckets
      where expires_at < v_now - interval '1 day'
      order by expires_at limit 100 for update skip locked
    );
  -- Return denials so failed attempts stay committed.
  return pg_catalog.jsonb_build_object('allowed', v_retry = 0, 'retryAfter', v_retry);
end;
$$;

revoke all on function public.consume_manual_phone_login_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_manual_phone_login_attempt(text, text) to service_role;

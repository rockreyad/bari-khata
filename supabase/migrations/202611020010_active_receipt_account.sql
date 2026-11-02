begin;

create function public.receipt_account_is_active()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users
    where id = (select auth.uid()) and deleted_at is null
  );
$$;

revoke all on function public.receipt_account_is_active() from public, anon, authenticated;
grant execute on function public.receipt_account_is_active() to authenticated;

create policy receipt_active_account on storage.objects
as restrictive for all to authenticated
using (
  bucket_id not in ('bari-receipts', 'bari-mcp-staging')
  or (select public.receipt_account_is_active())
)
with check (
  bucket_id not in ('bari-receipts', 'bari-mcp-staging')
  or (select public.receipt_account_is_active())
);

notify pgrst, 'reload schema';

commit;

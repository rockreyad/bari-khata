begin;

do $migration$
declare
  definition text := pg_get_functiondef('public.read_contact_share(text,integer,integer,bigint,text)'::regprocedure);
  marker text := $marker$'title', coalesce(c->>'title',''), 'workName', coalesce(w->>'name',''),$marker$;
begin
  if strpos(definition, $status$'status', c->'status'$status$) > 0 then return; end if;
  if strpos(definition, marker) = 0 or strpos(substr(definition, strpos(definition, marker) + length(marker)), marker) > 0 then
    raise exception 'unexpected_shared_contract_projection';
  end if;
  -- শুধু প্রকাশ্য চুক্তিতে রাখা অবস্থাটি যোগ হয়; বিদ্যমান টাকার হিসাব অক্ষত থাকে।
  execute replace(definition, marker, marker || E'\n      ''status'', c->''status'',');
end;
$migration$;

notify pgrst,'reload schema';
commit;

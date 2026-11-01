alter table public.ledger_documents add constraint ledger_currency_valid
  check ((document #>> '{project,currency}') is not distinct from 'BDT');

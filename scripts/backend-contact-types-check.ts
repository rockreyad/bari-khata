import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LedgerSchema } from "../src/domain/model";
import { contactPresets } from "../src/domain/contactTypes";

const container = "supabase_db_bari-khata";
const endpoint = JSON.parse(
  execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }),
)[0].Endpoints.docker.Host;
assert.match(process.env.DOCKER_HOST ?? endpoint, /^unix:\/\//);
assert.match(
  execFileSync(
    "docker",
    ["inspect", container, "--format", "{{.Config.Image}}"],
    {
      encoding: "utf8",
    },
  ).trim(),
  /supabase\/postgres:/,
  "শুধু স্থানীয় Supabase পরীক্ষার ডেটাবেস ব্যবহার করা যাবে।",
);
function db(sql: string) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ],
    { input: sql, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  ).trim();
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const fingerprint = () =>
  db(`select jsonb_build_object(
  'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'body',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by p.proname),'[]'::jsonb) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('contact_types_are_valid','preserve_contact_types')),
  'constraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.ledger_documents'::regclass and conname='contact_types_valid'),
  'trigger',(select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.ledger_documents'::regclass and tgname='ledger_preserve_contact_types')
);`);
const before = fingerprint();
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611050001_contact_types.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const owner = randomUUID();
const ledger = LedgerSchema.parse({
  works: [{ id: "work", name: "নমুনা খাতা" }],
  people: [
    {
      id: "person",
      name: "নমুনা ব্যক্তি",
      kind: "worker",
      contactType: "professional",
    },
  ],
  entries: [
    {
      id: "bill",
      kind: "expense",
      personId: "person",
      account: "labour",
      lines: [
        {
          id: "line",
          workId: "work",
          label: "নমুনা কাজ",
          costType: "labour",
          amount: 50000,
        },
      ],
    },
    {
      id: "paid",
      kind: "payment",
      personId: "person",
      account: "labour",
      allocations: [{ workId: "work", amount: 10000 }],
      paymentParts: [{ amount: 10000 }],
    },
  ],
});
const chunks = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s'; set local idle_in_transaction_session_timeout='30s';",
  "set local client_min_messages='warning'; drop trigger if exists ledger_preserve_contact_types on public.ledger_documents; alter table public.ledger_documents drop constraint if exists contact_types_valid; drop function if exists public.preserve_contact_types(); drop function if exists public.contact_types_are_valid(jsonb);",
  migration,
];
let checks = 0;
function check(document: unknown, valid: boolean) {
  chunks.push(
    `do $case$ begin if public.contact_types_are_valid(${json(document)}) is distinct from ${valid} then raise exception 'contact_type_case_${checks}'; end if; end; $case$;`,
  );
  checks++;
}
for (const preset of contactPresets)
  check(
    {
      ...ledger,
      people: [
        { ...ledger.people[0], kind: preset.kind, contactType: preset.id },
      ],
    },
    true,
  );
for (const kind of [null, "other"])
  check({ ...ledger, people: [{ ...ledger.people[0], kind }] }, true);
for (const contactType of ["unknown", "", 7, {}, []])
  check({ ...ledger, people: [{ ...ledger.people[0], contactType }] }, false);
check({ ...ledger, people: [{ ...ledger.people[0], kind: "shop" }] }, false);
check(
  { ...ledger, people: [{ ...ledger.people[0], contactType: null }] },
  true,
);
const oldPerson = { ...ledger.people[0] };
delete oldPerson.contactType;
check({ ...ledger, people: [oldPerson] }, true);
chunks.push(
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`type-rollback-${owner}@example.invalid`)});`,
);
chunks.push(
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(ledger)});`,
);
chunks.push(`do $preserve$ begin
  begin
    update public.ledger_documents set document=jsonb_set(document,'{people,0}',(document#>'{people,0}')-'contactType') where owner_id=${quote(owner)}::uuid;
    raise exception 'omission_was_allowed';
  exception when raise_exception then
    if sqlerrm<>'contact_type_would_be_lost' then raise; end if;
  end;
  begin
    update public.ledger_documents set document=jsonb_set(document,'{people,0,contactType}','"unknown"'::jsonb) where owner_id=${quote(owner)}::uuid;
    raise exception 'invalid_type_was_allowed';
  exception when check_violation then null;
  end;
  update public.ledger_documents set document=jsonb_set(document,'{people,0,role}','"অন্য পরিচয়"'::jsonb) where owner_id=${quote(owner)}::uuid;
  if (select document->'entries' from public.ledger_documents where owner_id=${quote(owner)}::uuid) is distinct from ${json(ledger.entries)} then raise exception 'financial_entries_changed'; end if;
  if (select document#>>'{people,0,contactType}' from public.ledger_documents where owner_id=${quote(owner)}::uuid)<>'professional' then raise exception 'type_changed_with_description'; end if;
  if has_function_privilege('anon','public.contact_types_are_valid(jsonb)','execute') or has_function_privilege('authenticated','public.preserve_contact_types()','execute') then raise exception 'unexpected_function_access'; end if;
end; $preserve$;`);
checks += 5;
chunks.push("rollback;");
try {
  db(chunks.join("\n"));
} finally {
  assert.equal(
    fingerprint(),
    before,
    "পরীক্ষার পরে ডেটাবেসের সংজ্ঞা আগের অবস্থায় থাকতে হবে।",
  );
  assert.equal(
    db(`select count(*) from auth.users where id=${quote(owner)}::uuid;`),
    "0",
  );
}
process.stdout.write(
  `স্থানীয় Supabase: ${checks}টি ধরন, তথ্য অক্ষত থাকা ও অনুমতির পরীক্ষা; সম্পূর্ণ rollback সফল।\n`,
);

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { LedgerSchema } from "../src/domain/model";

const container = "supabase_db_bari-khata";
const endpoint = JSON.parse(
  execFileSync("docker", ["context", "inspect"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
)[0].Endpoints.docker.Host;
assert.match(process.env.DOCKER_HOST ?? endpoint, /^unix:\/\//);
assert.match(
  execFileSync(
    "docker",
    ["inspect", container, "--format", "{{.Config.Image}}"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ),
  /supabase\/postgres:/,
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
  db(
    "select jsonb_build_object('function',coalesce(md5(pg_get_functiondef(to_regprocedure('public.person_work_links_are_valid(jsonb)'))),'absent'),'constraint',coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname='person_work_links_valid' and conrelid='public.ledger_documents'::regclass),'absent'),'trigger',coalesce((select pg_get_triggerdef(oid) from pg_trigger where tgname='ledger_preserve_person_work_links' and tgrelid='public.ledger_documents'::regclass),'absent'));",
  );
const original = fingerprint();
const installed =
  db(
    "select to_regprocedure('public.person_work_links_are_valid(jsonb)') is not null;",
  ) === "t";
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611030001_person_work_links.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const ledger = LedgerSchema.parse({
  works: [
    { id: "bathroom", name: "Synthetic bathroom" },
    { id: "electric", name: "Synthetic electric" },
  ],
  people: [
    {
      id: "worker",
      name: "Synthetic worker",
      kind: "worker",
      role: "Engineer",
      workIds: ["bathroom", "electric"],
    },
  ],
});
const legacy = structuredClone(ledger);
delete legacy.people[0].workIds;
const cleared = structuredClone(ledger);
cleared.people[0].workIds = [];
const unknown = structuredClone(ledger);
unknown.people[0].workIds = ["missing"];
const duplicate = structuredClone(ledger);
duplicate.people[0].workIds = ["bathroom", "bathroom"];
const malformed = structuredClone(ledger) as unknown as {
  people: { workIds: unknown }[];
};
malformed.people[0].workIds = null;
const owner = randomUUID();
const sql = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s';",
  ...(installed ? [] : [migration]),
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`person-links-${owner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(legacy)});`,
  `update public.ledger_documents set document=${json(ledger)} where owner_id=${quote(owner)}::uuid;`,
  `do $person_links$ declare rejected boolean:=false; actual jsonb; begin
    if not public.person_work_links_are_valid(${json(legacy)}) or not public.person_work_links_are_valid(${json(ledger)}) then raise exception 'valid_person_links_rejected'; end if;
    if public.person_work_links_are_valid(${json(unknown)}) or public.person_work_links_are_valid(${json(duplicate)}) or public.person_work_links_are_valid(${json(malformed)}) then raise exception 'invalid_person_links_accepted'; end if;
    begin update public.ledger_documents set document=${json(legacy)} where owner_id=${quote(owner)}::uuid;
    exception when others then if sqlerrm='person_work_links_would_be_lost' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'old_client_stripped_person_links'; end if;
    update public.ledger_documents set document=${json(cleared)} where owner_id=${quote(owner)}::uuid;
    select document into actual from public.ledger_documents where owner_id=${quote(owner)}::uuid;
    if actual->'entries' is distinct from ${json(ledger.entries)} or actual->'contracts' is distinct from ${json(ledger.contracts)} then raise exception 'association_created_financial_events'; end if;
    if actual#>'{people,0,workIds}' is distinct from '[]'::jsonb then raise exception 'explicit_clear_failed'; end if;
  end; $person_links$;`,
  "select 'person_work_links_rollback_passed'; rollback;",
].join("\n");
try {
  assert.equal(db(sql), "person_work_links_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    original,
    "The test must restore the original database schema.",
  );
  assert.equal(
    db(`select count(*) from auth.users where id=${quote(owner)}::uuid;`),
    "0",
    "The disposable account must be rolled back.",
  );
}
console.log(
  "Local person notebook associations: legacy data, multi-notebook links, invalid/duplicate IDs, explicit clearing, old-client rejection, unchanged financial events and complete rollback verified.",
);

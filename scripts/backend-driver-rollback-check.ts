import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { contactAccountSummary } from "../src/domain/contacts";
import { LedgerSchema } from "../src/domain/model";

const container = "supabase_db_bari-khata";
const signature = "public.read_contact_share(text,integer,integer,bigint,text)";
const endpoint = JSON.parse(
  execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }),
)[0].Endpoints.docker.Host;
assert.match(
  process.env.DOCKER_HOST ?? endpoint,
  /^unix:\/\//,
  "Only a local Docker socket may be used.",
);
const image = execFileSync(
  "docker",
  ["inspect", container, "--format", "{{.Config.Image}}"],
  { encoding: "utf8" },
).trim();
assert.match(
  image,
  /supabase\/postgres:/,
  "Only the local Supabase database container may be used.",
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
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const original = db(
  `select coalesce(md5(pg_get_functiondef(to_regprocedure(${quote(signature)}))), 'absent');`,
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611020003_driver_effective_accounts.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(
  migration,
  /^\s*(?:begin|commit|rollback)\s*;/im,
  "The migration must run inside the test transaction.",
);
const cases = [
  { name: "new-driver-account", legacyCash: false },
  {
    name: "voided-mixed-bill",
    legacyCash: true,
    mixed: true,
    cancelledMixed: true,
  },
  { name: "active-mixed-bill", legacyCash: true, mixed: true },
  {
    name: "voided-linked-original",
    legacyCash: true,
    cancelledTrip: true,
    linked: true,
  },
  { name: "historical-only", legacyCash: true, historicalTrip: true },
  {
    name: "historical-mixed-bill",
    legacyCash: true,
    mixed: true,
    historicalMixed: true,
  },
];
const owners: string[] = [];
const chunks = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='15s'; set local idle_in_transaction_session_timeout='30s';",
  migration,
];
for (const config of cases) {
  const owner = randomUUID();
  owners.push(owner);
  const ledger = LedgerSchema.parse({
    project: { name: "Synthetic rollback fixture" },
    works: [{ id: "door", name: "Synthetic door" }],
    people: [
      {
        id: "driver",
        name: "Synthetic driver",
        kind: "driver",
        phone: "PRIVATE_FIXTURE_PHONE",
      },
    ],
    entries: [
      {
        id: "trip",
        kind: "expense",
        account: "materials",
        personId: "driver",
        date: "2026-11-01",
        voided: "cancelledTrip" in config && config.cancelledTrip,
        balanceImpact:
          "historicalTrip" in config && config.historicalTrip
            ? "historical"
            : "normal",
        lines: [
          {
            id: "t",
            workId: "door",
            costType: "transport",
            label: "Synthetic van",
            amount: 100000,
          },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        account: config.legacyCash ? "materials" : "other",
        personId: "driver",
        date: "2026-11-02",
        relatedEntryId: "linked" in config && config.linked ? "trip" : null,
        allocations: [{ workId: "door", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
      ...("mixed" in config && config.mixed
        ? [
            {
              id: "mixed",
              kind: "expense",
              account: "materials",
              personId: "driver",
              voided: "cancelledMixed" in config && config.cancelledMixed,
              balanceImpact:
                "historicalMixed" in config && config.historicalMixed
                  ? "historical"
                  : "normal",
              lines: [
                {
                  id: "m",
                  workId: "door",
                  costType: "material",
                  amount: 10000,
                },
                {
                  id: "v",
                  workId: "door",
                  costType: "transport",
                  amount: 10000,
                },
              ],
            },
          ]
        : []),
    ],
  });
  chunks.push(
    `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`driver-rollback-${owner}@example.invalid`)});`,
  );
  chunks.push(
    `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${quote(JSON.stringify(ledger))}::jsonb);`,
  );
  for (const account of ["other", "materials"] as const) {
    const token = randomBytes(32).toString("hex");
    const summary = contactAccountSummary(
      ledger,
      ledger.people[0],
      account,
      "door",
    );
    const expected = JSON.stringify({
      cost: summary.cost,
      paid: summary.netPaid,
      payable: summary.payable,
      advance: summary.advance,
      historicalCost: summary.historicalCost,
    });
    chunks.push(
      `insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash) values (${quote(owner)}::uuid,'driver',${quote(account)},'door',encode(extensions.digest(${quote(token)},'sha256'),'hex'));`,
    );
    chunks.push(`set local role anon;
do $driver_check$
declare actual jsonb;
begin
  actual := public.read_contact_share(${quote(token)},0,40,null,null);
  if actual->'totals' is distinct from ${quote(expected)}::jsonb then
    raise exception 'driver_share_totals_mismatch: %: %', ${quote(`${config.name}/${account}`)}, actual->'totals';
  end if;
  if (actual->>'total')::integer is distinct from ${summary.entries.length} then
    raise exception 'driver_share_rows_mismatch: %', ${quote(`${config.name}/${account}`)};
  end if;
  if position('PRIVATE_FIXTURE_PHONE' in actual::text)>0 then raise exception 'driver_share_private_field_leak'; end if;
end;
$driver_check$;
reset role;`);
  }
}
chunks.push(`set local role anon;
do $driver_invalid$
begin
  if public.read_contact_share('invalid-token') is not null then raise exception 'invalid_token_exposed_data'; end if;
  if public.read_contact_share(${quote(randomBytes(32).toString("hex"))}) is not null then raise exception 'unknown_token_exposed_data'; end if;
  if has_table_privilege('anon','public.ledger_documents','select') then raise exception 'anon_direct_ledger_access'; end if;
end;
$driver_invalid$;
reset role;
select 'driver_share_rollback_checks_passed';
rollback;`);
try {
  assert.equal(db(chunks.join("\n")), "driver_share_rollback_checks_passed");
} finally {
  const ids = owners.map((id) => `${quote(id)}::uuid`).join(",");
  const cleanup = JSON.parse(
    db(`select json_build_object(
    'functionUnchanged',coalesce(md5(pg_get_functiondef(to_regprocedure(${quote(signature)}))),'absent')=${quote(original)},
    'usersAbsent',not exists(select 1 from auth.users where id in (${ids})),
    'ledgersAbsent',not exists(select 1 from public.ledger_documents where owner_id in (${ids})),
    'linksAbsent',not exists(select 1 from public.contact_share_links where owner_id in (${ids}))
  );`),
  );
  assert.deepEqual(
    cleanup,
    {
      functionUnchanged: true,
      usersAbsent: true,
      ledgersAbsent: true,
      linksAbsent: true,
    },
    "Rollback must restore the original function and remove all synthetic fixtures.",
  );
}
console.log(
  "Local Supabase SQL: 12 driver/account cases, invalid anonymous links and full rollback verified.",
);

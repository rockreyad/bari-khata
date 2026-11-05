import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { contactAccountSummary } from "../src/domain/contacts";
import {
  LedgerSchema,
  type Ledger,
  type PersonKind,
} from "../src/domain/model";

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
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const signatures = [
  "public.read_contact_share(text,integer,integer,bigint,text)",
  "private.contact_share_parts(jsonb)",
];
const fingerprint = () =>
  db(`select jsonb_object_agg(name,jsonb_build_object(
  'definition',md5(pg_get_functiondef(p.oid)),'acl',p.proacl::text,
  'owner',p.proowner,'definer',p.prosecdef,'config',p.proconfig))
  from unnest(array[${signatures.map(quote).join(",")}]) name
  left join pg_proc p on p.oid=to_regprocedure(name);`);
const original = fingerprint();
const originalProperties = Object.fromEntries(
  Object.entries(JSON.parse(original)).map(([name, value]) => {
    const { definition: _definition, ...properties } = value as Record<
      string,
      unknown
    >;
    return [name, properties];
  }),
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611040005_identity_independent_contact_accounts.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const owner = randomUUID();
const chunks = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s'; set local idle_in_transaction_session_timeout='30s';",
  migration,
  `do $function_security$
declare actual jsonb;
begin
  select jsonb_object_agg(name,jsonb_build_object('acl',p.proacl::text,'owner',p.proowner,'definer',p.prosecdef,'config',p.proconfig)) into actual
  from unnest(array[${signatures.map(quote).join(",")}]) name join pg_proc p on p.oid=to_regprocedure(name);
  if actual is distinct from ${quote(JSON.stringify(originalProperties))}::jsonb then raise exception 'function_permissions_changed'; end if;
end;
$function_security$;`,
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`identity-rollback-${owner}@example.invalid`)});`,
];
const identities: { kind: PersonKind | null; name: string; role: string }[] = [
  { kind: "driver", name: "নমুনা ব্যক্তি", role: "গাড়িচালক" },
  { kind: "shop", name: "নমুনা দোকান", role: "সিমেন্ট বিক্রেতা" },
  { kind: "worker", name: "নমুনা ব্যক্তি", role: "রাজমিস্ত্রি" },
  { kind: "other", name: "নমুনা ব্যক্তি", role: "ইঞ্জিনিয়ার" },
  { kind: null, name: "নমুনা ভ্যানচালক", role: "" },
  { kind: null, name: "নমুনা দোকান", role: "" },
  { kind: null, name: "নমুনা ব্যক্তি", role: "ইঞ্জিনিয়ার" },
];
const cases = [
  { name: "ordinary", mixed: false, historical: false, voided: false },
  {
    name: "ambiguous-material-cash",
    mixed: true,
    historical: false,
    voided: false,
  },
  {
    name: "historical-transport",
    mixed: false,
    historical: true,
    voided: false,
  },
  {
    name: "voided-linked-transport",
    mixed: false,
    historical: false,
    voided: true,
  },
];
let checks = 0;
let revision = 0;
for (const config of cases) {
  const base = LedgerSchema.parse({
    project: { name: "নমুনা পরিচয় পরীক্ষার খাতা" },
    works: [
      { id: "door", name: "নমুনা দরজা" },
      { id: "roof", name: "নমুনা ছাদ" },
    ],
    people: [
      { id: "person", ...identities[0], phone: "PRIVATE_FIXTURE_PHONE" },
      { id: "unrelated", name: "PRIVATE_OTHER_PERSON", kind: "other" },
    ],
    contracts: [
      {
        id: "job",
        personId: "person",
        workId: "door",
        total: 100000,
        status: "done",
      },
    ],
    entries: [
      {
        id: "trip",
        kind: "expense",
        account: "materials",
        personId: "person",
        date: "2026-11-01",
        voided: config.voided,
        balanceImpact: config.historical ? "historical" : "normal",
        lines: [
          {
            id: "trip-line",
            workId: "door",
            costType: "transport",
            label: "নমুনা গাড়িভাড়া",
            amount: 100000,
          },
        ],
      },
      {
        id: "trip-paid",
        kind: "payment",
        account: "materials",
        personId: "person",
        date: "2026-11-02",
        relatedEntryId: config.voided ? "trip" : null,
        allocations: [{ workId: "door", amount: 60000 }],
        paymentParts: [{ amount: 60000 }],
      },
      {
        id: "unload",
        kind: "expense",
        account: "other",
        personId: "person",
        lines: [
          {
            id: "unload-line",
            workId: "door",
            costType: "unload",
            amount: 20000,
          },
        ],
      },
      {
        id: "unload-paid",
        kind: "payment",
        account: "other",
        personId: "person",
        relatedEntryId: "unload",
        allocations: [{ workId: "door", amount: 5000 }],
        paymentParts: [{ amount: 5000 }],
      },
      {
        id: "material",
        kind: "expense",
        account: "materials",
        personId: "person",
        lines: [
          {
            id: "material-line",
            workId: "roof",
            costType: "material",
            amount: 30000,
          },
        ],
      },
      {
        id: "material-paid",
        kind: "payment",
        account: "materials",
        personId: "person",
        relatedEntryId: "material",
        allocations: [{ workId: "roof", amount: 20000 }],
        paymentParts: [{ amount: 20000 }],
      },
      {
        id: "job-paid",
        kind: "payment",
        account: "labour",
        personId: "person",
        contractId: "job",
        allocations: [{ workId: "door", amount: 40000 }],
        paymentParts: [{ amount: 40000 }],
      },
      {
        id: "unrelated-bill",
        kind: "expense",
        account: "other",
        personId: "unrelated",
        note: "PRIVATE_OTHER_NOTE",
        lines: [
          {
            id: "unrelated-line",
            workId: "door",
            costType: "other",
            amount: 90000,
          },
        ],
      },
      ...(config.mixed
        ? [
            {
              id: "mixed",
              kind: "expense",
              account: "materials",
              personId: "person",
              lines: [
                {
                  id: "mixed-material",
                  workId: "door",
                  costType: "material",
                  amount: 10000,
                },
                {
                  id: "mixed-transport",
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
  const tokens = Object.fromEntries(
    ["other", "materials", "labour"].map((account) => [
      account,
      randomBytes(32).toString("hex"),
    ]),
  );
  const stableEntries = JSON.stringify(base.entries);
  const financial = (
    ledger: Ledger,
    account: "other" | "materials" | "labour",
  ) => {
    const summary = contactAccountSummary(ledger, ledger.people[0], account);
    return {
      cost: summary.cost,
      paid: summary.netPaid,
      payable: summary.reconciledPayable,
      advance: summary.reconciledAdvance,
      historicalCost: summary.historicalCost,
    };
  };
  if (config.name === "ordinary") {
    assert.deepEqual(financial(base, "other"), {
      cost: 120000,
      paid: 65000,
      payable: 55000,
      advance: 0,
      historicalCost: 0,
    });
    assert.deepEqual(financial(base, "materials"), {
      cost: 30000,
      paid: 20000,
      payable: 10000,
      advance: 0,
      historicalCost: 0,
    });
    assert.deepEqual(financial(base, "labour"), {
      cost: 0,
      paid: 40000,
      payable: 60000,
      advance: 0,
      historicalCost: 0,
    });
  }
  for (const [index, identity] of identities.entries()) {
    const ledger = LedgerSchema.parse({
      ...base,
      people: [{ ...base.people[0], ...identity }, base.people[1]],
    });
    assert.equal(JSON.stringify(ledger.entries), stableEntries);
    revision++;
    if (revision === 1) {
      chunks.push(
        `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,${revision},${quote(JSON.stringify(ledger))}::jsonb);`,
      );
    } else {
      chunks.push(
        `update public.ledger_documents set document=${quote(JSON.stringify(ledger))}::jsonb,revision=${revision} where owner_id=${quote(owner)}::uuid;`,
      );
    }
    if (index === 0) {
      for (const [account, token] of Object.entries(tokens))
        chunks.push(
          `insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash) values (${quote(owner)}::uuid,'person',${quote(account)},null,encode(extensions.digest(${quote(token)},'sha256'),'hex'));`,
        );
    }
    for (const account of ["other", "materials", "labour"] as const) {
      const expected = financial(base, account);
      assert.deepEqual(financial(ledger, account), expected);
      const summary = contactAccountSummary(base, base.people[0], account);
      const ids = summary.entries
        .filter((entry) => !entry.voided)
        .map((entry) => entry.id)
        .sort();
      const visible = summary.entries.filter((entry) => !entry.voided);
      const activityIds = visible
        .filter(
          (entry) =>
            !(
              entry.kind === "payment" &&
              entry.balanceImpact !== "historical" &&
              visible.some(
                (bill) =>
                  bill.id === entry.relatedEntryId &&
                  bill.kind === "expense" &&
                  bill.balanceImpact !== "historical",
              )
            ),
        )
        .map((entry) => entry.id)
        .sort();
      const token = tokens[account];
      const label = `${config.name}/${identity.kind ?? identity.name}/${account}`;
      chunks.push(`set local role anon;
do $identity_check$
declare actual jsonb; activity jsonb; search_result jsonb; projection jsonb; actual_ids jsonb;
begin
  actual:=public.read_contact_share(${quote(token)},0,40,null,null);
  select jsonb_object_agg(key,value) into projection from jsonb_each(actual->'totals') where key in ('cost','paid','payable','advance','historicalCost');
  if projection is distinct from ${quote(JSON.stringify(expected))}::jsonb then raise exception 'identity_totals_mismatch: % %',${quote(label)},projection; end if;
  select coalesce(jsonb_agg(row->>'key' order by row->>'key'),'[]'::jsonb) into actual_ids from jsonb_array_elements(actual->'rows') row;
  if actual_ids is distinct from ${quote(JSON.stringify(ids))}::jsonb then raise exception 'identity_rows_mismatch: % %',${quote(label)},actual_ids; end if;
  activity:=public.read_contact_share_activity(${quote(token)},0,20,null,null,null);
  search_result:=public.search_contact_share(${quote(token)},0,20,null,null,null);
  if activity->'totals' is distinct from actual->'totals' or search_result->'totals' is distinct from actual->'totals' then raise exception 'identity_projection_totals_mismatch: %',${quote(label)}; end if;
  if (search_result->>'total')::integer<>${ids.length} then raise exception 'identity_search_rows_mismatch: %',${quote(label)}; end if;
  select coalesce(jsonb_agg(row->>'key' order by row->>'key'),'[]'::jsonb) into actual_ids from jsonb_array_elements(search_result->'rows') row;
  if actual_ids is distinct from ${quote(JSON.stringify(ids))}::jsonb then raise exception 'identity_search_scope_mismatch: %',${quote(label)}; end if;
  select coalesce(jsonb_agg(row->>'key' order by row->>'key'),'[]'::jsonb) into actual_ids from jsonb_array_elements(activity->'rows') row;
  if actual_ids is distinct from ${quote(JSON.stringify(activityIds))}::jsonb then raise exception 'identity_activity_scope_mismatch: %',${quote(label)}; end if;
  if public.read_contact_share_entry(${quote(token)},'unrelated-bill',${revision}) is not null then raise exception 'other_person_detail_exposed'; end if;
  if position('PRIVATE_FIXTURE_PHONE' in actual::text||activity::text||search_result::text)>0 or position('PRIVATE_OTHER' in actual::text||activity::text||search_result::text)>0 then raise exception 'identity_private_field_leak'; end if;
  ${
    account === "other"
      ? `if public.read_contact_share_entry(${quote(token)},'unload',${revision}) is null or public.read_contact_share_entry(${quote(token)},'unload-paid',${revision}) is null then raise exception 'nontransport_other_history_hidden'; end if;
  if public.read_contact_share_entry(${quote(token)},'material',${revision}) is not null then raise exception 'other_account_detail_exposed'; end if;
  if (public.read_contact_share_payments(${quote(token)},'unload',${revision},0,20)->>'total')::integer<>1 then raise exception 'other_payment_history_hidden'; end if;`
      : ""
  }
end;
$identity_check$;
reset role;`);
      checks++;
    }
  }
}
chunks.push(`set local role anon;
do $identity_security$
begin
  if public.read_contact_share('invalid-token') is not null or public.read_contact_share(${quote(randomBytes(32).toString("hex"))}) is not null then raise exception 'invalid_token_exposed_data'; end if;
  if has_table_privilege('anon','public.ledger_documents','select') then raise exception 'anon_direct_ledger_access'; end if;
  begin
    perform private.contact_share_parts('{}'::jsonb);
    raise exception 'anon_private_projection_access';
  exception when insufficient_privilege then null;
  end;
end;
$identity_security$;
reset role;
select 'contact_identity_rollback_checks_passed';
rollback;`);
try {
  assert.equal(
    db(chunks.join("\n")),
    "contact_identity_rollback_checks_passed",
  );
} finally {
  assert.equal(
    fingerprint(),
    original,
    "পরীক্ষার পরে function ও অনুমতি আগের মতো থাকতে হবে।",
  );
  assert.equal(
    db(`select not exists(select 1 from auth.users where id=${quote(owner)}::uuid)
    and not exists(select 1 from public.ledger_documents where owner_id=${quote(owner)}::uuid)
    and not exists(select 1 from public.contact_share_links where owner_id=${quote(owner)}::uuid);`),
    "t",
    "পরীক্ষার নমুনা তথ্য ডেটাবেসে থাকা যাবে না।",
  );
}
console.log(
  `স্থানীয় Supabase: ${checks}টি পরিচয়/account যাচাই, গোপনীয়তা ও সম্পূর্ণ rollback ঠিক আছে।`,
);

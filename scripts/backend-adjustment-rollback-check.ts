import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { EntrySchema, LedgerSchema, type Ledger } from "../src/domain/model";
import { appendBalanceAdjustment } from "../src/domain/balanceAdjustments";
import { setEntryVoided } from "../src/domain/ledger";
import { reconciledTotals } from "../src/domain/adjustmentMath";

const container = "supabase_db_bari-khata";
const endpoint = JSON.parse(
  execFileSync("docker", ["context", "inspect"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
)[0].Endpoints.docker.Host;
assert.match(
  process.env.DOCKER_HOST ?? endpoint,
  /^unix:\/\//,
  "Only a local Docker socket may be used.",
);
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
  "Only the local Bari Khata database container may be used.",
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
    {
      input: sql,
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${quote(JSON.stringify(value))}::jsonb`;
const signatures = [
  "public.ledger_document_is_valid(jsonb)",
  "public.ledger_relations_are_valid(jsonb)",
  "public.read_contact_share(text,integer,integer,bigint,text)",
  "private.mcp_document_changes(jsonb,jsonb)",
  "private.mcp_asset_json(private.mcp_assets)",
  "public.adjustment_snapshot_is_valid(jsonb,jsonb)",
  "public.adjustment_immutable_core(jsonb)",
  "public.adjustment_entry_core(jsonb)",
  "public.ledger_adjustments_are_valid(jsonb)",
  "public.balance_adjustments_are_preserved(jsonb,jsonb)",
  "public.preserve_balance_adjustments()",
];
const fingerprint = () =>
  db(`select jsonb_build_object(
  'functions',(select jsonb_object_agg(name,coalesce(md5(pg_get_functiondef(to_regprocedure(name))),'absent')) from unnest(array[${signatures.map(quote).join(",")}]) name),
  'constraint',coalesce((select pg_get_constraintdef(oid) from pg_constraint where conname='ledger_adjustments_valid' and conrelid='public.ledger_documents'::regclass),'absent'),
  'trigger',coalesce((select pg_get_triggerdef(oid) from pg_trigger where tgname='ledger_preserve_balance_adjustments' and tgrelid='public.ledger_documents'::regclass),'absent')
);`);
const original = fingerprint();
const migration = readFileSync(
  new URL(
    "../supabase/migrations/202611030003_balance_adjustments.sql",
    import.meta.url,
  ),
  "utf8",
)
  .trim()
  .replace(/^begin;\s*/i, "")
  .replace(/\s*commit;$/i, "");
assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
const installed =
  db(
    "select to_regprocedure('public.ledger_adjustments_are_valid(jsonb)') is not null;",
  ) === "t";
const installedSetup = installed
  ? [
      "alter table public.ledger_documents drop constraint ledger_adjustments_valid;",
      "drop trigger ledger_preserve_balance_adjustments on public.ledger_documents;",
      "drop function public.preserve_balance_adjustments(),public.balance_adjustments_are_preserved(jsonb,jsonb),public.ledger_adjustments_are_valid(jsonb),public.adjustment_entry_core(jsonb),public.adjustment_immutable_core(jsonb),public.adjustment_snapshot_is_valid(jsonb,jsonb);",
    ]
  : [];
const initial = LedgerSchema.parse({
  works: [{ id: "roof", name: "Synthetic roof" }],
  people: [{ id: "shop", name: "Synthetic shop", kind: "shop" }],
  entries: [
    {
      id: "bill",
      kind: "expense",
      personId: "shop",
      account: "materials",
      lines: [
        { id: "line", workId: "roof", costType: "material", amount: 100000 },
      ],
    },
    {
      id: "paid",
      kind: "payment",
      personId: "shop",
      account: "materials",
      allocations: [{ workId: "roof", amount: 30000 }],
      paymentParts: [{ method: "cash", amount: 30000 }],
    },
  ],
});
const adjusted = appendBalanceAdjustment(
  initial,
  {
    target: "person",
    basis: "balance",
    personId: "shop",
    account: "materials",
    workId: "roof",
    expectedBefore: 70000,
    after: 50000,
    reason: "Synthetic balance correction",
    date: "2026-11-03",
  },
  "2026-11-03T10:00:00.000Z",
);
const adjustmentId = adjusted.entries.at(-1)!.id;
const voided = setEntryVoided(adjusted, adjustmentId, true);
const restored = setEntryVoided(voided, adjustmentId, false);
const credit = appendBalanceAdjustment(
  restored,
  {
    target: "person",
    basis: "balance",
    personId: "shop",
    account: "materials",
    workId: "roof",
    expectedBefore: 50000,
    after: -5000,
    reason: "Synthetic credit correction",
    date: "2026-11-03",
  },
  "2026-11-03T11:00:00.000Z",
);
const totalsCorrected = LedgerSchema.parse({
  ...credit,
  entries: [
    ...credit.entries,
    EntrySchema.parse({
      id: "person-paid-correction",
      kind: "adjustment",
      personId: "shop",
      account: "materials",
      adjustment: {
        target: "person",
        basis: "paid",
        account: "materials",
        delta: 10000,
        before: 30000,
        after: 40000,
        workId: null,
      },
      note: "Synthetic paid total correction",
      createdAt: "2026-11-03T12:00:00.000Z",
      updatedAt: "2026-11-03T12:00:00.000Z",
    }),
    EntrySchema.parse({
      id: "person-cost-correction",
      kind: "adjustment",
      personId: "shop",
      account: "materials",
      adjustment: {
        target: "person",
        basis: "cost",
        account: "materials",
        delta: -10000,
        before: 100000,
        after: 90000,
        workId: null,
      },
      note: "Synthetic cost total correction",
      createdAt: "2026-11-03T12:01:00.000Z",
      updatedAt: "2026-11-03T12:01:00.000Z",
    }),
  ],
});
const workCorrected = LedgerSchema.parse({
  ...totalsCorrected,
  entries: [
    ...totalsCorrected.entries,
    EntrySchema.parse({
      id: "work-only-correction",
      kind: "adjustment",
      personId: null,
      account: "other",
      adjustment: {
        target: "work",
        basis: "cost",
        account: null,
        delta: 5000,
        before: 100000,
        after: 105000,
        workId: "roof",
      },
      note: "Synthetic notebook total correction",
      createdAt: "2026-11-03T12:02:00.000Z",
      updatedAt: "2026-11-03T12:02:00.000Z",
    }),
  ],
});
const corrupt = (mutate: (value: any) => void, value: Ledger = adjusted) => {
  const copy = structuredClone(value);
  mutate(copy);
  return copy;
};
const invalid = [
  corrupt((v) => {
    v.entries.at(-1).adjustment.target = "unknown";
  }),
  corrupt((v) => {
    v.entries.at(-1).adjustment.basis = "unknown";
  }),
  corrupt((v) => {
    v.entries.at(-1).adjustment.account = "labour";
  }),
  corrupt((v) => {
    v.entries.at(-1).adjustment.delta = 0;
  }),
  corrupt((v) => {
    v.entries.at(-1).adjustment.after += 1;
  }),
  corrupt((v) => {
    v.entries.at(-1).adjustment.before = 70000.5;
  }),
  corrupt((v) => {
    v.entries.at(-1).adjustment.after = Number.MAX_SAFE_INTEGER + 1;
  }),
  corrupt((v) => {
    v.entries.at(-1).adjustment.workId = "missing";
  }),
  corrupt((v) => {
    v.entries.at(-1).adjustment.extra = true;
  }),
  corrupt((v) => {
    v.entries.at(-1).paymentParts = [{ method: "cash", amount: 1 }];
  }),
  corrupt((v) => {
    v.entries.at(-1).note = "  ";
  }),
  corrupt((v) => {
    v.entries.at(-1).balanceImpact = "historical";
  }),
  corrupt((v) => {
    v.entries.at(-1).reviewStatus = "needs_review";
  }),
  corrupt((v) => {
    v.entries.at(-1).personId = null;
  }),
  corrupt((v) => {
    v.entries[0].adjustment = v.entries.at(-1).adjustment;
  }),
  corrupt((v) => {
    v.entries.at(-1).voided = true;
  }),
  corrupt((v) => {
    v.entries.at(-1).revisions[0].before.adjustment.delta = 1;
  }, voided),
  corrupt((v) => {
    v.entries.at(-1).revisions[0].before.note = "Changed original reason";
  }, voided),
  corrupt((v) => {
    v.entries.at(-1).adjustment.workId = null;
  }, workCorrected),
  corrupt((v) => {
    v.entries.at(-1).personId = "shop";
  }, workCorrected),
  corrupt((v) => {
    v.entries.at(-1).adjustment.account = "other";
  }, workCorrected),
];
const downgrades = [
  initial,
  corrupt((v) => {
    v.entries.at(-1).adjustment.after = 40000;
    v.entries.at(-1).adjustment.delta = -30000;
  }, restored),
  corrupt((v) => {
    v.entries.at(-1).note = "Rewritten original reason";
  }, adjusted),
  corrupt((v) => {
    v.entries.at(-1).revisions = [];
  }, restored),
];
const collision = structuredClone(adjusted);
collision.entries = [
  EntrySchema.parse({ ...adjusted.entries.at(-1)!, id: "bill" }),
  initial.entries[1],
];
const owner = randomUUID();
const update = (value: unknown) =>
  `update public.ledger_documents set document=${json(value)} where owner_id=${quote(owner)}::uuid;`;
const token = randomBytes(32).toString("hex");
const workToken = randomBytes(32).toString("hex");
const jobOwner = randomUUID();
let jobs = LedgerSchema.parse({
  works: [
    { id: "roof", name: "Synthetic roof" },
    { id: "wall", name: "Synthetic wall" },
  ],
  people: [{ id: "worker", name: "Synthetic worker", kind: "worker" }],
  contracts: [
    { id: "roof-job", personId: "worker", workId: "roof", total: 100000 },
    { id: "wall-job", personId: "worker", workId: "wall", total: 50000 },
  ],
  entries: [
    {
      id: "roof-paid",
      kind: "payment",
      personId: "worker",
      account: "labour",
      contractId: "roof-job",
      allocations: [{ workId: "roof", amount: 20000 }],
      paymentParts: [{ method: "cash", amount: 20000 }],
    },
    {
      id: "wall-paid",
      kind: "payment",
      personId: "worker",
      account: "labour",
      contractId: "wall-job",
      allocations: [{ workId: "wall", amount: 70000 }],
      paymentParts: [{ method: "cash", amount: 70000 }],
    },
  ],
});
jobs = appendBalanceAdjustment(
  jobs,
  {
    target: "person",
    basis: "paid",
    personId: "worker",
    account: "labour",
    expectedBefore: 90000,
    after: 100000,
    reason: "Synthetic account total",
    date: "2026-11-03",
  },
  "2026-11-03T12:00:00.000Z",
);
jobs = appendBalanceAdjustment(
  jobs,
  {
    target: "person",
    basis: "paid",
    personId: "worker",
    account: "labour",
    contractId: "roof-job",
    expectedBefore: 20000,
    after: 30000,
    reason: "Synthetic job total",
    date: "2026-11-03",
  },
  "2026-11-03T12:01:00.000Z",
);
const parity = [
  `insert into auth.users(id,aud,role,email) values (${quote(jobOwner)}::uuid,'authenticated','authenticated',${quote(`adjustment-jobs-${jobOwner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(jobOwner)}::uuid,1,${json(jobs)});`,
];
for (const workId of [undefined, "roof", "wall"]) {
  const scope = {
    personId: "worker",
    account: "labour" as const,
    ...(workId ? { workId } : {}),
  };
  const totals = reconciledTotals(jobs, scope);
  const expected = {
    actualCost: totals.actualCost,
    actualPaid: totals.actualPaid,
    actualRefunds: totals.actualRefunds,
    actualNetPaid: totals.actualNetPaid,
    costCorrection: totals.costCorrection,
    paidCorrection: totals.paidCorrection,
    balanceCorrection: totals.balanceCorrection,
    adjustment: totals.owedCorrection,
    reconciledCost: totals.reconciledCost,
    reconciledNetPaid: totals.reconciledNetPaid,
    reconciledBalance: totals.reconciledBalance,
    reconciledPayable: totals.reconciledPayable,
    reconciledAdvance: totals.reconciledAdvance,
  };
  const linkToken = randomBytes(32).toString("hex");
  parity.push(
    `insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash) values (${quote(jobOwner)}::uuid,'worker','labour',${workId ? quote(workId) : "null"},encode(extensions.digest(${quote(linkToken)},'sha256'),'hex'));`,
    `do $job_parity$ declare actual jsonb; expected jsonb:=${json(expected)}; metric text; begin
      actual:=public.read_contact_share(${quote(linkToken)})->'totals';
      for metric in select jsonb_object_keys(expected) loop
        if actual->metric is distinct from expected->metric then raise exception 'job_share_domain_mismatch: %',metric; end if;
      end loop;
    end; $job_parity$;`,
  );
}
const advanceOwner = randomUUID();
const advanceToken = randomBytes(32).toString("hex");
const advanceBase = LedgerSchema.parse({
  works: [{ id: "roof", name: "Synthetic roof" }],
  people: [{ id: "shop", name: "Synthetic shop", kind: "shop" }],
  entries: [
    {
      id: "advance-cash",
      kind: "payment",
      personId: "shop",
      account: "materials",
      allocations: [{ workId: "roof", amount: 3000 }],
      paymentParts: [{ method: "cash", amount: 3000 }],
    },
  ],
});
const personAdvance = appendBalanceAdjustment(
  advanceBase,
  {
    target: "person",
    basis: "paid",
    personId: "shop",
    account: "materials",
    expectedBefore: 3000,
    after: 1000,
    reason: "Synthetic own advance correction",
    date: "2026-11-03",
  },
  "2026-11-03T12:00:00.000Z",
);
const workAdvance = appendBalanceAdjustment(
  personAdvance,
  {
    target: "work",
    basis: "paid",
    personId: null,
    account: null,
    workId: "roof",
    expectedBefore: 3000,
    after: 1000,
    reason: "Synthetic unallocated notebook headline",
    date: "2026-11-03",
  },
  "2026-11-03T12:01:00.000Z",
);
const workAdvanceTotals = reconciledTotals(workAdvance, { workId: "roof" });
assert.equal(workAdvanceTotals.reconciledNetPaid, 1000);
assert.equal(workAdvanceTotals.reconciledPayable, 0);
assert.equal(workAdvanceTotals.reconciledAdvance, 3000);
assert.equal(workAdvanceTotals.unallocatedWorkOwedCorrection, 2000);
parity.push(
  `insert into auth.users(id,aud,role,email) values (${quote(advanceOwner)}::uuid,'authenticated','authenticated',${quote(`adjustment-advance-${advanceOwner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(advanceOwner)}::uuid,1,${json(workAdvance)});`,
  `insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash) values (${quote(advanceOwner)}::uuid,'shop','materials',null,encode(extensions.digest(${quote(advanceToken)},'sha256'),'hex'));`,
  `do $own_advance$ declare statement jsonb; saved jsonb; begin
    statement:=public.read_contact_share(${quote(advanceToken)});
    if statement#>>'{totals,actualPaid}'<>'3000' or statement#>>'{totals,reconciledNetPaid}'<>'1000' or
      statement#>>'{totals,reconciledPayable}'<>'0' or statement#>>'{totals,reconciledAdvance}'<>'1000' or
      statement#>>'{totals,reconciledBalance}'<>'-1000' or statement#>>'{counts,adjustment}'<>'1' then raise exception 'own_advance_correction_mismatch'; end if;
    select document into saved from public.ledger_documents where owner_id=${quote(advanceOwner)}::uuid;
    if saved#>'{entries,2,adjustment}' is distinct from ${json(workAdvance.entries[2].adjustment)} then raise exception 'work_headline_metadata_lost'; end if;
  end; $own_advance$;`,
);
const statements = [
  "begin; set local lock_timeout='2s'; set local statement_timeout='20s'; set local idle_in_transaction_session_timeout='30s';",
  ...installedSetup,
  migration,
  `insert into auth.users(id,aud,role,email) values (${quote(owner)}::uuid,'authenticated','authenticated',${quote(`adjustment-${owner}@example.invalid`)});`,
  `insert into public.ledger_documents(owner_id,revision,document) values (${quote(owner)}::uuid,1,${json(initial)});`,
  `do $collision$ declare rejected boolean:=false; begin
    begin ${update(collision)} exception when others then if sqlerrm='balance_adjustment_would_be_lost' then rejected:=true; else raise; end if; end;
    if not rejected then raise exception 'existing_bill_retyped_as_adjustment'; end if;
  end; $collision$;`,
  update(adjusted),
  `do $invalid$ declare value jsonb; rejected boolean; begin
    if not public.ledger_document_is_valid(${json(adjusted)}) or not public.ledger_adjustments_are_valid(${json(adjusted)}) then raise exception 'valid_adjustment_rejected'; end if;
    for value in select x from jsonb_array_elements(${json(invalid)}) x loop
      if public.ledger_document_is_valid(value) and public.ledger_adjustments_are_valid(value) then raise exception 'corrupt_adjustment_validated'; end if;
      rejected:=false;
      begin update public.ledger_documents set document=value where owner_id=${quote(owner)}::uuid;
      exception when check_violation or raise_exception then rejected:=true; end;
      if not rejected then raise exception 'corrupt_adjustment_saved'; end if;
    end loop;
    if (select document from public.ledger_documents where owner_id=${quote(owner)}::uuid) is distinct from ${json(adjusted)} then raise exception 'failed_write_changed_ledger'; end if;
  end; $invalid$;`,
  update(voided),
  update(restored),
  `do $downgrade$ declare value jsonb; rejected boolean; changes jsonb; begin
    for value in select x from jsonb_array_elements(${json(downgrades)}) x loop
      if public.balance_adjustments_are_preserved(${json(restored)},value) then raise exception 'adjustment_loss_validated'; end if;
      rejected:=false;
      begin update public.ledger_documents set document=value where owner_id=${quote(owner)}::uuid;
      exception when others then if sqlerrm='balance_adjustment_would_be_lost' then rejected:=true; else raise; end if; end;
      if not rejected then raise exception 'old_client_erased_adjustment'; end if;
    end loop;
    changes:=private.mcp_document_changes(${json(adjusted)},${json(voided)});
    if (changes->>'amountPaisa')::numeric<>20000 or not(changes->'requiredScopes' ? 'entries:void_restore') then raise exception 'mcp_adjustment_limit_bypassed'; end if;
  end; $downgrade$;`,
  `insert into public.contact_share_links(owner_id,person_id,account,work_id,token_hash) values
    (${quote(owner)}::uuid,'shop','materials',null,encode(extensions.digest(${quote(token)},'sha256'),'hex')),
    (${quote(owner)}::uuid,'shop','materials','roof',encode(extensions.digest(${quote(workToken)},'sha256'),'hex'));`,
  `do $shared$ declare statement jsonb; scoped jsonb; row jsonb; begin
    statement:=public.read_contact_share(${quote(token)});
    scoped:=public.read_contact_share(${quote(workToken)});
    if statement->'totals' is distinct from scoped->'totals' or
      statement#>>'{totals,cost}'<>'100000' or statement#>>'{totals,paid}'<>'30000' or
      statement#>>'{totals,adjustment}'<>'-20000' or statement#>>'{totals,payable}'<>'50000' or
      statement#>>'{totals,advance}'<>'0' or statement#>>'{counts,adjustment}'<>'1' then raise exception 'shared_adjustment_totals_wrong'; end if;
    statement:=public.read_contact_share(${quote(token)},0,40,null,'adjustment');
    row:=statement#>'{rows,0}';
    if statement->>'total'<>'1' or row->>'adjustment'<>'-20000' or row->>'adjustmentBasis'<>'balance' or row->>'charge'<>'0' or row->>'paid'<>'0' or row->>'description'<>'Synthetic balance correction' then raise exception 'shared_adjustment_row_wrong'; end if;
  end; $shared$;`,
  update(credit),
  `do $credit$ declare statement jsonb; begin
    statement:=public.read_contact_share(${quote(token)});
    if statement#>>'{totals,cost}'<>'100000' or statement#>>'{totals,paid}'<>'30000' or statement#>>'{totals,adjustment}'<>'-75000' or statement#>>'{totals,payable}'<>'0' or statement#>>'{totals,advance}'<>'5000' then raise exception 'signed_credit_adjustment_wrong'; end if;
  end; $credit$;`,
  update(totalsCorrected),
  `do $corrected_totals$ declare statement jsonb; scoped jsonb; row jsonb; begin
    statement:=public.read_contact_share(${quote(token)});
    scoped:=public.read_contact_share(${quote(workToken)});
    if statement#>>'{totals,cost}'<>'100000' or statement#>>'{totals,paid}'<>'30000' or
      statement#>>'{totals,costCorrection}'<>'-10000' or statement#>>'{totals,paidCorrection}'<>'10000' or
      statement#>>'{totals,balanceCorrection}'<>'-75000' or statement#>>'{totals,adjustment}'<>'-95000' or
      statement#>>'{totals,reconciledCost}'<>'90000' or statement#>>'{totals,reconciledNetPaid}'<>'40000' or
      statement#>>'{totals,reconciledBalance}'<>'-25000' or statement#>>'{totals,reconciledAdvance}'<>'25000' then raise exception 'reconciled_totals_wrong'; end if;
    if scoped#>>'{counts,adjustment}'<>'2' or scoped#>>'{totals,adjustment}'<>'-75000' then raise exception 'unallocated_person_correction_leaked_into_notebook'; end if;
    select r into row from jsonb_array_elements(statement->'rows') r where r->>'key'='person-paid-correction';
    if row->>'adjustment'<>'10000' or row->>'adjustmentBasis'<>'paid' or row->>'paid'<>'0' then raise exception 'paid_correction_faked_cash'; end if;
  end; $corrected_totals$;`,
  update(workCorrected),
  `do $notebook_scope$ declare statement jsonb; begin
    statement:=public.read_contact_share(${quote(token)});
    if statement#>>'{counts,adjustment}'<>'4' or statement#>>'{totals,adjustment}'<>'-95000' or
      exists(select 1 from jsonb_array_elements(statement->'rows') r where r->>'key'='work-only-correction') then raise exception 'work_correction_leaked_into_person_share'; end if;
    if not public.ledger_document_is_valid(${json(workCorrected)}) or not public.ledger_adjustments_are_valid(${json(workCorrected)}) then raise exception 'work_target_rejected'; end if;
  end; $notebook_scope$;`,
  ...parity,
  "select 'adjustment_rollback_passed'; rollback;",
];
try {
  assert.equal(db(statements.join("\n")), "adjustment_rollback_passed");
} finally {
  assert.equal(
    fingerprint(),
    original,
    "All temporary schema changes must be rolled back.",
  );
  assert.equal(
    db(
      `select not exists(select 1 from auth.users where id in (${quote(owner)}::uuid,${quote(jobOwner)}::uuid,${quote(advanceOwner)}::uuid)) and not exists(select 1 from public.ledger_documents where owner_id in (${quote(owner)}::uuid,${quote(jobOwner)}::uuid,${quote(advanceOwner)}::uuid));`,
    ),
    "t",
    "Synthetic accounts and ledger data must be rolled back.",
  );
}
console.log(
  "Local adjustment persistence: signed balances, immutable history, old-client protection, MCP amount limits, shared noncash totals and complete rollback verified.",
);

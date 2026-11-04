import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { LedgerSchema } from "../src/domain/model";
import {
  appendBalanceAdjustment,
  readBalanceAdjustmentScope,
} from "../src/domain/balanceAdjustments";
import {
  SharedEntrySchema,
  SharedStatementSchema,
} from "../src/features/sharing/shareModel";

const status = JSON.parse(
  execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
assert.ok(
  /^http:\/\/(127\.0\.0\.1|localhost):55431$/.test(status.API_URL ?? ""),
  "Only the local Bari-Khata backend is allowed.",
);
assert.ok(
  status.ANON_KEY && status.SERVICE_ROLE_KEY,
  "Local backend credentials are required.",
);
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
};
const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
const anonymous = createClient(status.API_URL, status.ANON_KEY, options);
const owner = createClient(status.API_URL, status.ANON_KEY, options);
const marker = randomUUID();
let ownerId = "";
const uploaded: string[] = [];
let checks = 0;
function check(value: unknown, label: string): asserts value {
  assert.ok(value, label);
  checks++;
}
function value<R extends { data: unknown; error: unknown }>(
  result: R,
  label: string,
): R["data"] {
  if (result.error) throw new Error(`${label} failed.`);
  return result.data;
}
async function rpc(name: string, args: object, client = anonymous) {
  return value(await client.rpc(name, args), name);
}
const bill = (
  id: string,
  label: string,
  amount = 10000,
  workId = "roof",
  personId = "shop",
  account = "materials",
  costType = "material",
) => ({
  id,
  kind: "expense",
  personId,
  account,
  date: "2026-11-04",
  createdAt: "2026-11-04T01:00:00Z",
  updatedAt: "2026-11-04T01:00:00Z",
  lines: [{ id: `${id}-line`, workId, label, amount, costType }],
});
const cash = (
  id: string,
  amount: number,
  workId = "roof",
  personId = "shop",
  account = "materials",
) => ({
  id,
  kind: "payment",
  personId,
  account,
  date: "2026-11-04",
  allocations: [{ workId, amount }],
  paymentParts: [{ method: "cash", amount }],
});
try {
  const email = `shared-search-${marker}@example.invalid`;
  const password = `${randomBytes(24).toString("hex")}Aa9!`;
  const user = value(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { shared_search_check: marker },
    }),
    "Creating disposable account",
  ).user;
  check(
    user?.email === email && user.app_metadata.shared_search_check === marker,
    "Disposable account marker must match.",
  );
  ownerId = user.id;
  value(
    await owner.auth.signInWithPassword({ email, password }),
    "Signing in disposable account",
  );
  const receiptId = randomUUID(),
    splitReceiptId = randomUUID();
  const content = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZcAAAAASUVORK5CYII=",
    "base64",
  );
  const receipt = (id: string, name: string) => ({
    id,
    name,
    mime: "image/png",
    size: content.length,
  });
  let ledger = LedgerSchema.parse({
    project: { name: "নমুনা শেয়ার পরীক্ষা" },
    works: [
      { id: "roof", name: "নমুনা ছাদ" },
      { id: "floor", name: "নমুনা মেঝে" },
    ],
    people: [
      { id: "shop", name: "নমুনা দোকান", kind: "shop", phone: "PRIVATE_PHONE" },
      { id: "another", name: "অন্য নমুনা", kind: "shop" },
      { id: "driver", name: "নমুনা গাড়িচালক", kind: "driver" },
      { id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" },
    ],
    items: [{ id: "sample-item", name: "নমুনা আসল মালের নাম" }],
    contracts: [
      {
        id: "job",
        personId: "worker",
        workId: "roof",
        title: "নমুনা কাজের চুক্তি",
        total: 9000,
      },
    ],
    entries: [
      {
        ...bill("cement", "Portland Cement সিমেন্ট", 123450),
        note: "নমুনা বিশেষ নোট",
        receipts: [receipt(receiptId, "sample.png")],
        source: {
          file: "PRIVATE_SOURCE",
          cell: "PRIVATE_CELL",
          checksum: "PRIVATE_CHECKSUM",
        },
      },
      ...Array.from({ length: 25 }, (_, index) =>
        bill(`page-${index}`, `PaginationSample ${index}`),
      ),
      ...Array.from({ length: 25 }, (_, index) => ({
        ...cash(`page-cash-${index}`, 10000),
        relatedEntryId: `page-${index}`,
        note: `GroupedPaymentSample ${index}`,
      })),
      {
        ...cash("cement-cash", 10000),
        relatedEntryId: "cement",
        note: "নমুনা পরিশোধের কথা",
      },
      {
        ...bill("item-name", "", 5000),
        lines: [
          {
            id: "item-name-line",
            workId: "roof",
            itemId: "sample-item",
            label: "",
            amount: 5000,
            quantity: "2.5",
            unit: "বস্তা",
            costType: "material",
          },
        ],
      },
      bill("landfill", "নমুনা মাটি ভরাট", 600000),
      bill("small-amount", "নমুনা ছোট অঙ্ক", 6000),
      {
        ...bill("split", "ছাদের পাথর"),
        note: "hiddenworkmemoqzx",
        lines: [
          {
            id: "split-roof",
            workId: "roof",
            label: "ছাদের পাথর",
            costType: "material",
            amount: 10000,
          },
          {
            id: "split-floor",
            workId: "floor",
            label: "zxprivatefloorword",
            costType: "material",
            amount: 70000,
          },
        ],
        receipts: [receipt(splitReceiptId, "hiddenvouchernameqzx.pdf")],
      },
      {
        ...cash("split-cash", 12000),
        relatedEntryId: "split",
        note: "hiddenpaymentmemoqzx",
        allocations: [
          { workId: "roof", amount: 3000 },
          { workId: "floor", amount: 9000 },
        ],
        paymentParts: [
          { method: "bank", amount: 6000 },
          { method: "other", amount: 6000 },
        ],
      },
      { ...cash("refund", 1000), kind: "refund", relatedEntryId: "cement" },
      {
        ...bill("returned", "নমুনা ফেরত", 1000),
        kind: "expense_credit",
        relatedEntryId: "cement",
      },
      {
        ...bill("old-bill", "নমুনা পুরোনো বিল", 5000),
        balanceImpact: "historical",
      },
      {
        ...cash("old-cash", 900),
        balanceImpact: "historical",
        relatedEntryId: "cement",
      },
      { ...bill("voided", "privatevoidwordqzx"), voided: true },
      { ...cash("voided-cash", 333), relatedEntryId: "voided" },
      { ...cash("historical-bill-cash", 444), relatedEntryId: "old-bill" },
      bill("another-person", "privatepersonwordqzx", 9999, "roof", "another"),
      bill(
        "another-account",
        "privateaccountwordqzx",
        9999,
        "roof",
        "shop",
        "other",
        "other",
      ),
      bill(
        "transport",
        "নমুনা পরিবহন",
        2000,
        "roof",
        "driver",
        "materials",
        "transport",
      ),
      {
        ...cash("transport-cash", 1000, "roof", "driver"),
        relatedEntryId: "transport",
      },
      bill("driver-material", "নমুনা গাড়িচালকের মাল", 3000, "roof", "driver"),
      {
        ...bill(
          "wages",
          "নমুনা কাজের বিল",
          4000,
          "roof",
          "worker",
          "labour",
          "labour",
        ),
        contractId: "job",
      },
      {
        ...cash("wage-cash", 2000, "roof", "worker", "labour"),
        contractId: "job",
      },
      bill(
        "worker-material",
        "নমুনা মিস্ত্রির কেনা মাল",
        6000,
        "roof",
        "worker",
      ),
    ],
  });
  const adjustmentScope = {
    target: "person" as const,
    basis: "paid" as const,
    personId: "shop",
    account: "materials" as const,
    workId: "roof",
  };
  const current = readBalanceAdjustmentScope(ledger, adjustmentScope).value;
  ledger = appendBalanceAdjustment(ledger, {
    ...adjustmentScope,
    expectedBefore: current,
    after: current + 500,
    reason: "নমুনা দেওয়া মোট সমন্বয়",
  });
  const saved = await rpc(
    "save_ledger_snapshot",
    { p_request_id: randomUUID(), p_expected_revision: 0, p_document: ledger },
    owner,
  );
  const revision = saved.revision;
  for (const id of [receiptId, splitReceiptId]) {
    const path = `${ownerId}/${id}`;
    value(
      await admin.storage
        .from("bari-receipts")
        .upload(path, content, { contentType: "image/png" }),
      "Uploading disposable receipt",
    );
    uploaded.push(path);
  }
  async function share(
    personId: string,
    account: string,
    workId: string | null = null,
  ) {
    return rpc(
      "create_contact_share",
      { p_person_id: personId, p_account: account, p_work_id: workId },
      owner,
    );
  }
  const all = await share("shop", "materials"),
    roof = await share("shop", "materials", "roof");
  const driver = await share("driver", "other", "roof"),
    worker = await share("worker", "labour", "roof");
  const search = (
    token: string,
    query = "",
    offset = 0,
    pinned: number | null = revision,
  ) =>
    rpc("search_contact_share", {
      p_token: token,
      p_offset: offset,
      p_limit: 20,
      p_revision: pinned,
      p_query: query,
    });
  const detail = (token: string, id: string, pinned = revision) =>
    rpc("read_contact_share_entry", {
      p_token: token,
      p_entry_id: id,
      p_revision: pinned,
    });
  const activity = (token: string, query = "", offset = 0, pinned = revision) =>
    rpc("read_contact_share_activity", {
      p_token: token,
      p_offset: offset,
      p_limit: 20,
      p_revision: pinned,
      p_query: query,
    });
  const authorization = (
    token: string,
    id: string,
    receipt: string,
    client = admin,
    pinned = revision,
  ) =>
    rpc(
      "contact_share_receipt_authorization",
      {
        p_token: token,
        p_entry_id: id,
        p_receipt_id: receipt,
        p_revision: pinned,
      },
      client,
    );
  for (const link of [all, roof, driver, worker]) {
    const source = SharedStatementSchema.parse(
      await rpc("read_contact_share", {
        p_token: link.token,
        p_offset: 0,
        p_limit: 20,
        p_revision: revision,
      }),
    );
    const result = SharedStatementSchema.parse(await search(link.token));
    check(
      JSON.stringify(source) === JSON.stringify(result) ||
        (JSON.stringify(source.totals) === JSON.stringify(result.totals) &&
          JSON.stringify(source.counts) === JSON.stringify(result.counts) &&
          source.total === result.total &&
          JSON.stringify(source.rows) === JSON.stringify(result.rows)),
      "Unfiltered search must preserve existing statement accounting and classification.",
    );
  }
  const first = SharedStatementSchema.parse(
    await search(roof.token, "paginationsample"),
  );
  const second = SharedStatementSchema.parse(
    await search(roof.token, "paginationsample", first.nextOffset!),
  );
  check(
    first.total === 25 &&
      first.rows.length === 20 &&
      first.nextOffset === 20 &&
      second.rows.length === 5 &&
      second.nextOffset === null,
    "Search must paginate all matching history in bounded pages.",
  );
  check(
    new Set([...first.rows, ...second.rows].map((row) => row.key)).size === 25,
    "Search pages must not repeat entries.",
  );
  const full = SharedStatementSchema.parse(await search(roof.token));
  check(
    JSON.stringify(first.totals) === JSON.stringify(full.totals) &&
      JSON.stringify(first.counts) === JSON.stringify(full.counts),
    "Search cannot change full-scope totals or counts.",
  );
  for (const query of [
    "Portlnd",
    "cemnt",
    "সিমেনট",
    "১২৩৪.৫০",
    "৳১,২৩৪.৫০",
    "বিশেষ",
    "sample.png",
  ])
    check(
      (await search(roof.token, query)).rows.some(
        (row: { key: string }) => row.key === "cement",
      ),
      `Synthetic fuzzy/digit/note/receipt-name query ${query} must find the intended entry.`,
    );
  for (const query of ["ভরট", "৳৬,০০০"])
    check(
      (await search(roof.token, query)).rows.some(
        (row: { key: string }) => row.key === "landfill",
      ),
      "Bengali typo and taka-formatted amount must find their scoped entry.",
    );
  for (const query of ["৳৬,০০০", "6000"]) {
    const matches = await search(roof.token, query);
    check(
      matches.rows.some((row: { key: string }) => row.key === "landfill"),
      "Amount search must use displayed taka values.",
    );
    check(
      !matches.rows.some((row: { key: string }) => row.key === "small-amount"),
      "Amount search cannot confuse internal poisha with displayed taka.",
    );
  }
  check(
    (await search(roof.token, "2026-11-04")).total > 0,
    "ISO date search must find scoped history.",
  );
  check(
    (await search(roof.token, "৪ নভেম্বর")).total > 0,
    "Bengali human date search must find scoped history.",
  );
  check(
    (await search(roof.token, "payment")).rows.some(
      (row: { key: string }) => row.key === "split-cash",
    ),
    "Transaction-kind aliases must replace kind filters.",
  );
  for (const query of [
    "zxprivatefloorword",
    "hiddenworkmemoqzx",
    "hiddenvouchernameqzx",
    "hiddenpaymentmemoqzx",
    "bank",
    "privatepersonwordqzx",
    "privateaccountwordqzx",
    "privatevoidwordqzx",
  ])
    check(
      (await search(roof.token, query)).total === 0,
      "Search must not match off-scope or partial-entry private information.",
    );
  check(
    (await search(all.token, "hiddenworkmemoqzx")).rows.some(
      (row: { key: string }) => row.key === "split",
    ),
    "Whole-entry shares may search their own note.",
  );
  const visible = await detail(roof.token, "cement");
  check(
    visible.key === "cement" &&
      visible.revision === revision &&
      visible.charge === 123450 &&
      visible.note === "নমুনা বিশেষ নোট" &&
      visible.receipts.length === 1,
    "Whole-entry detail must expose its safe scoped data.",
  );
  check(
    Object.keys(visible).sort().join(",") ===
      [
        "revision",
        "key",
        "date",
        "kind",
        "historical",
        "charge",
        "paid",
        "adjustment",
        "adjustmentBasis",
        "description",
        "works",
        "note",
        "lines",
        "paymentParts",
        "paymentMethods",
        "receipts",
        "settlement",
        "payments",
      ]
        .sort()
        .join(","),
    "Detail cannot expose owner, provenance, source or audit fields.",
  );
  SharedEntrySchema.parse(visible);
  const groupedFirst = SharedStatementSchema.parse(
    await activity(roof.token, "paginationsample"),
  );
  const groupedSecond = SharedStatementSchema.parse(
    await activity(roof.token, "paginationsample", groupedFirst.nextOffset!),
  );
  check(
    groupedFirst.total === 25 &&
      groupedFirst.rows.length === 20 &&
      groupedSecond.rows.length === 5 &&
      groupedSecond.nextOffset === null,
    "Linked bill/payment groups must paginate before returning bounded pages.",
  );
  check(
    new Set([...groupedFirst.rows, ...groupedSecond.rows].map((row) => row.key))
      .size === 25 &&
      [...groupedFirst.rows, ...groupedSecond.rows].every(
        (row) =>
          row.kind === "expense" &&
          row.paid === 0 &&
          row.settlement?.paid === 10000 &&
          row.settlement.balance === 0,
      ),
    "Grouped pages must contain each bill once and preserve raw financial event fields.",
  );
  const byPayment = SharedStatementSchema.parse(
    await activity(roof.token, "groupedpaymentsample"),
  );
  check(
    byPayment.total === 25 &&
      byPayment.rows.every(
        (row) => row.kind === "expense" && row.settlement?.paymentCount === 1,
      ),
    "Searching linked payment metadata must find the whole bill group.",
  );
  const cementGroup = (await activity(roof.token, "Portland")).rows.find(
    (row: { key: string }) => row.key === "cement",
  );
  check(
    cementGroup.settlement.paid === 10000 &&
      cementGroup.settlement.returned === 1000 &&
      cementGroup.settlement.refunded === 1000 &&
      cementGroup.settlement.balance === 113450 &&
      cementGroup.settlement.paymentCount === 1,
    "Bill settlement must include only explicitly related current payments, returns and refunds.",
  );
  const returnedGroup = await activity(roof.token, "নমুনা ফেরত"),
    refundGroup = await activity(roof.token, "refund"),
    historicalGroup = await activity(roof.token, "9");
  check(
    returnedGroup.rows.some(
      (row: { kind: string }) => row.kind === "expense_credit",
    ) &&
      refundGroup.rows.some((row: { kind: string }) => row.kind === "refund"),
    "Returns and refunds must remain independent visible events.",
  );
  check(
    historicalGroup.rows.some(
      (row: { key: string; historical: boolean }) =>
        row.key === "old-cash" && row.historical,
    ),
    "A historical linked payment must remain independent and cannot settle a current bill.",
  );
  for (const [amount, key] of [
    ["3.33", "voided-cash"],
    ["4.44", "historical-bill-cash"],
  ]) {
    check(
      (await activity(roof.token, amount)).rows.some(
        (row: { key: string; kind: string }) =>
          row.key === key && row.kind === "payment",
      ),
      "Payments against a cancelled or historical bill must remain visible independently.",
    );
  }
  const fullActivity = SharedStatementSchema.parse(await activity(roof.token));
  check(
    JSON.stringify(fullActivity.totals) === JSON.stringify(full.totals) &&
      JSON.stringify(fullActivity.counts) === JSON.stringify(full.counts),
    "Grouping cannot change accounting totals or raw event counts.",
  );
  check(
    visible.payments.length === 1 &&
      visible.payments[0].key === "cement-cash" &&
      visible.payments[0].paid === 10000 &&
      visible.payments[0].paymentParts[0].amount === 10000,
    "Bill detail must include current linked payment history with safe methods.",
  );
  const enriched = SharedEntrySchema.parse(
    await detail(roof.token, "item-name"),
  );
  check(
    enriched.lines[0].label === "নমুনা আসল মালের নাম" &&
      enriched.lines[0].quantity === 2.5 &&
      enriched.lines[0].unit === "বস্তা" &&
      (await activity(roof.token, "আসল মালের নাম")).rows.some(
        (row: { key: string }) => row.key === "item-name",
      ),
    "Item names and quantities must be available when the legacy line label is empty.",
  );
  const partial = await detail(roof.token, "split"),
    partialCash = await detail(roof.token, "split-cash");
  check(
    partial.charge === 10000 &&
      partial.lines.length === 1 &&
      partial.lines[0].workName === "নমুনা ছাদ" &&
      partial.note === "" &&
      partial.receipts.length === 0,
    "Partial bill detail must omit other notebooks and global metadata.",
  );
  SharedEntrySchema.parse(partial);
  SharedEntrySchema.parse(partialCash);
  check(
    partial.settlement.paid === 3000 &&
      partial.payments.length === 1 &&
      partial.payments[0].paid === 3000 &&
      partial.payments[0].paymentParts.length === 0 &&
      partial.payments[0].paymentMethods.length === 0,
    "Grouped bill history cannot reveal off-scope payment amounts or methods.",
  );
  check(
    partialCash.relatedBill.key === "split" &&
      partialCash.relatedBill.charge === 10000 &&
      partialCash.relatedBill.lines.length === 1 &&
      partialCash.relatedBill.lines[0].label === "ছাদের পাথর",
    "Linked payment detail must show only its shared notebook's purchased items.",
  );
  for (const query of [
    "zxprivatefloorword",
    "hiddenworkmemoqzx",
    "hiddenvouchernameqzx",
    "hiddenpaymentmemoqzx",
    "bank",
    "privatepersonwordqzx",
    "privateaccountwordqzx",
    "privatevoidwordqzx",
  ])
    check(
      (await activity(roof.token, query)).total === 0,
      "Grouped search must not expose off-scope data through linked events.",
    );
  check(
    (await activity(worker.token, "কাজের চুক্তি")).rows.some(
      (row: { key: string; description: string }) =>
        row.key === "wage-cash" && row.description === "নমুনা কাজের চুক্তি",
    ),
    "Standalone worker payments must retain a scoped contract description.",
  );
  check(
    partialCash.paid === 3000 &&
      partialCash.paymentParts.length === 0 &&
      partialCash.paymentMethods.length === 0 &&
      partialCash.note === "",
    "Partial cash detail cannot expose whole-entry amounts or methods.",
  );
  check(
    (await detail(all.token, "split-cash")).paymentParts.length === 2,
    "Whole-entry cash methods remain visible.",
  );
  for (const id of ["another-person", "another-account", "voided", "missing"])
    check(
      (await detail(roof.token, id)) === null,
      "Forbidden, voided or missing detail must be unavailable.",
    );
  check(
    (await detail(worker.token, "worker-material")) === null,
    "Worker-purchased materials cannot become wages.",
  );
  check(
    (await detail(driver.token, "transport-cash")).paid === 1000 &&
      (await detail(driver.token, "driver-material")) === null,
    "Legacy driver effective-account boundaries must remain exact.",
  );
  const authorized = await authorization(roof.token, "cement", receiptId);
  check(
    authorized.storagePath === `${ownerId}/${receiptId}` &&
      authorized.id === receiptId &&
      Object.keys(authorized).length === 5,
    "Receipt authorization must return only its safe immutable path and metadata.",
  );
  async function proxy(pinned = revision) {
    return fetch("http://localhost:5180/api/shared-receipt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5180",
      },
      body: JSON.stringify({
        token: roof.token,
        entryId: "cement",
        receiptId,
        revision: pinned,
      }),
    });
  }
  const streamed = await proxy();
  check(
    streamed.status === 200 &&
      streamed.headers.get("content-type")?.startsWith("image/png"),
    "Real local receipt proxy must stream the authorized PNG.",
  );
  check(
    streamed.headers.get("cache-control")?.includes("no-store") &&
      streamed.headers.get("x-content-type-options") === "nosniff",
    "Public receipt response must not be cached or MIME-sniffed.",
  );
  check(
    Buffer.from(await streamed.arrayBuffer()).equals(content),
    "Receipt proxy must preserve exact uploaded bytes.",
  );
  const staleReceipt = await proxy(revision + 1);
  check(
    staleReceipt.status === 409 &&
      (await staleReceipt.json()).error === "share_changed",
    "Real receipt route must reject a stale revision.",
  );
  check(
    (await authorization(roof.token, "split", splitReceiptId)) === null,
    "A partial-work share cannot authorize a whole-entry voucher.",
  );
  check(
    (await authorization(roof.token, "cement", splitReceiptId)) === null,
    "Receipt identity must belong to the selected entry.",
  );
  check(
    (await authorization(roof.token, "cement", "../outside")) === null,
    "Receipt path traversal must be rejected.",
  );
  const denied = await anonymous.rpc("contact_share_receipt_authorization", {
    p_token: roof.token,
    p_entry_id: "cement",
    p_receipt_id: receiptId,
    p_revision: revision,
  });
  check(
    Boolean(denied.error),
    "Public callers cannot execute receipt authorization.",
  );
  for (const name of [
    "search_contact_share",
    "read_contact_share_activity",
    "read_contact_share_entry",
    "contact_share_receipt_authorization",
  ]) {
    const args =
      name === "search_contact_share" || name === "read_contact_share_activity"
        ? { p_token: roof.token, p_revision: revision + 1 }
        : name === "read_contact_share_entry"
          ? {
              p_token: roof.token,
              p_entry_id: "cement",
              p_revision: revision + 1,
            }
          : {
              p_token: roof.token,
              p_entry_id: "cement",
              p_receipt_id: receiptId,
              p_revision: revision + 1,
            };
    const result = await (
      name === "contact_share_receipt_authorization" ? admin : anonymous
    ).rpc(name, args);
    check(
      result.error?.message.includes("share_changed"),
      "Every public capability read must enforce its pinned revision.",
    );
  }
  await rpc("revoke_contact_share", { p_id: roof.id }, owner);
  const revokedReceipt = await proxy();
  check(
    revokedReceipt.status === 404 &&
      (await revokedReceipt.json()).error === "share_unavailable",
    "Real receipt route must reject a revoked capability.",
  );
  check(
    (await search(roof.token)) === null &&
      (await detail(roof.token, "cement")) === null &&
      (await authorization(roof.token, "cement", receiptId)) === null,
    "Revocation must invalidate search, detail and receipt authorization.",
  );
  check(
    (await search(all.token)).total > 0,
    "Revoking one scope cannot revoke another independently shared scope.",
  );
} finally {
  if (uploaded.length)
    value(
      await admin.storage.from("bari-receipts").remove(uploaded),
      "Removing disposable receipts",
    );
  if (ownerId) {
    const user = value(
      await admin.auth.admin.getUserById(ownerId),
      "Checking disposable cleanup marker",
    ).user;
    assert.ok(
      user?.app_metadata.shared_search_check === marker,
      "Cleanup may remove only this disposable account.",
    );
    value(
      await admin.auth.admin.deleteUser(ownerId),
      "Removing disposable account",
    );
  }
}
console.log(
  `Local shared search/detail/receipt checks passed (${checks}); disposable account and receipts removed.`,
);

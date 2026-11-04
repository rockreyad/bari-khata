import { describe, expect, it } from "vitest";
import { setEntityRemoved } from "../../domain/entityDeletion";
import { contractSummary, summarize } from "../../domain/ledger";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { applicableQuickContracts, entryContext } from "./entryContext";
import { buildQuickEntry, QuickDraftSchema } from "./quickEntry";

const at = "2026-11-02T06:00:00Z";
function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "worker", name: "শাহ আলম", kind: "worker" },
      { id: "shop", name: "দোকান", kind: "shop" },
    ],
    contracts: [
      {
        id: "door-job",
        workId: "door",
        personId: "worker",
        title: "দরজা লাগানো",
        total: 600000,
        rate: 600000,
      },
      {
        id: "roof-job",
        workId: "roof",
        personId: "worker",
        title: "ছাদের কাজ",
        total: 200000,
        rate: 200000,
      },
    ],
    entries: [
      {
        id: "door-bill",
        kind: "expense",
        personId: "shop",
        date: "2026-11-01",
        lines: [
          { id: "door-line", workId: "door", label: "দরজা", amount: 300000 },
        ],
      },
      {
        id: "door-paid",
        kind: "payment",
        personId: "shop",
        relatedEntryId: "door-bill",
        date: "2026-11-01",
        allocations: [{ workId: "door", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
      {
        id: "roof-paid",
        kind: "payment",
        personId: "worker",
        contractId: "roof-job",
        account: "labour",
        date: "2026-11-01",
        allocations: [{ workId: "roof", amount: 25000 }],
        paymentParts: [{ amount: 25000 }],
      },
    ],
  });
}
function payment(change: Record<string, unknown> = {}) {
  return QuickDraftSchema.parse({
    id: "new-payment",
    date: "2026-11-02",
    kind: "payment",
    workId: "door",
    personId: "worker",
    contractId: "door-job",
    account: "labour",
    amount: "700",
    ...change,
  });
}
function transaction(
  kind: "expense" | "payment" | "wage" | "refund" | "return",
) {
  return QuickDraftSchema.parse({
    id: `new-${kind}`,
    paymentId: `new-${kind}-cash`,
    refundId: `new-${kind}-refund`,
    date: "2026-11-02",
    kind,
    workId: "door",
    personId: kind === "wage" ? "worker" : "shop",
    amount: "125",
    account: kind === "wage" ? "labour" : "materials",
    costType: kind === "wage" ? "labour" : "material",
    rows: [
      {
        id: `line-${kind}`,
        label: kind === "wage" ? "মজুরি" : "দরজার মাল",
        amount: "125",
      },
    ],
  });
}
function expectBlocked(
  ledger: Ledger,
  draft: ReturnType<typeof QuickDraftSchema.parse>,
) {
  const before = structuredClone(ledger);
  const beforeDraft = structuredClone(draft);
  expect(() => buildQuickEntry(ledger, draft)).toThrow("removed_entity");
  expect(ledger).toEqual(before);
  expect(draft).toEqual(beforeDraft);
}

describe("archived records in quick entry", () => {
  it("does not infer an archived notebook from the worker's old job or payments", () => {
    const ledger = setEntityRemoved(
      fixture(),
      "work",
      "roof",
      true,
      undefined,
      at,
    );
    const before = structuredClone(ledger);
    expect(
      entryContext(ledger, { kind: "payment", personId: "worker" }),
    ).toMatchObject({ workId: "door", contractId: "door-job" });
    expect(ledger).toEqual(before);
    expect(
      ledger.entries.find((entry) => entry.id === "roof-paid")?.contractId,
    ).toBe("roof-job");
  });
  it("does not infer a removed job from the worker's single current notebook", () => {
    const initial = fixture();
    initial.contracts = initial.contracts.filter(
      (job) => job.id === "door-job",
    );
    initial.entries = initial.entries.filter(
      (entry) => entry.id !== "roof-paid",
    );
    const ledger = setEntityRemoved(
      LedgerSchema.parse(initial),
      "contract",
      "door-job",
      true,
      undefined,
      at,
    );
    expect(
      entryContext(ledger, {
        kind: "payment",
        personId: "worker",
        workId: "door",
      }),
    ).toMatchObject({ workId: "door", contractId: "", purpose: "charge" });
  });
  it("uses a sole active job rather than an archived job's notebook history", () => {
    const ledger = setEntityRemoved(
      fixture(),
      "contract",
      "roof-job",
      true,
      undefined,
      at,
    );
    expect(
      entryContext(ledger, { kind: "payment", personId: "worker" }),
    ).toMatchObject({ workId: "door", contractId: "door-job" });
  });
  it.each(["work", "person", "contract"] as const)(
    "hides a %s that was archived from applicable quick contracts",
    (kind) => {
      const id =
        kind === "work" ? "door" : kind === "person" ? "worker" : "door-job";
      const ledger = setEntityRemoved(fixture(), kind, id, true, undefined, at);
      const before = structuredClone(ledger);
      expect(applicableQuickContracts(ledger, "worker", "door")).toEqual([]);
      expect(ledger).toEqual(before);
    },
  );
  it("keeps active house-wide work applicable while hiding its archived sibling", () => {
    const initial = LedgerSchema.parse({
      ...fixture(),
      contracts: [
        {
          id: "house-old",
          scope: "house",
          personId: "worker",
          title: "আগের কাজ",
          total: 300000,
        },
        {
          id: "house-current",
          scope: "house",
          personId: "worker",
          title: "নতুন কাজ",
          total: 400000,
        },
      ],
      entries: [],
    });
    const ledger = setEntityRemoved(
      initial,
      "contract",
      "house-old",
      true,
      undefined,
      at,
    );
    expect(
      applicableQuickContracts(ledger, "worker").map((job) => job.id),
    ).toEqual(["house-current"]);
    expect(
      applicableQuickContracts(ledger, "worker", "door").map((job) => job.id),
    ).toEqual(["house-current"]);
  });
  it.each(["expense", "payment", "wage", "refund", "return"] as const)(
    "rejects a new %s aimed at an archived notebook without changing the original ledger",
    (kind) => {
      const ledger = setEntityRemoved(
        fixture(),
        "work",
        "door",
        true,
        undefined,
        at,
      );
      expectBlocked(ledger, transaction(kind));
    },
  );
  it.each(["expense", "payment", "refund", "return"] as const)(
    "rejects a new shop %s when the selected shop was archived",
    (kind) => {
      const ledger = setEntityRemoved(
        fixture(),
        "person",
        "shop",
        true,
        undefined,
        at,
      );
      expectBlocked(ledger, transaction(kind));
    },
  );
  it("rejects a new wage against an archived worker", () => {
    const ledger = setEntityRemoved(
      fixture(),
      "person",
      "worker",
      true,
      undefined,
      at,
    );
    expectBlocked(ledger, transaction("wage"));
  });
  it("rejects a stale selected job that was archived after the draft was opened", () => {
    const initial = fixture();
    const draft = payment();
    const ledger = setEntityRemoved(
      initial,
      "contract",
      "door-job",
      true,
      undefined,
      at,
    );
    expectBlocked(ledger, draft);
  });
  it("retains an explicitly requested archived job ID so the draft cannot silently pay a different job", () => {
    const ledger = setEntityRemoved(
      fixture(),
      "contract",
      "roof-job",
      true,
      undefined,
      at,
    );
    const context = entryContext(ledger, {
      kind: "payment",
      personId: "worker",
      contractId: "roof-job",
    });
    expect(context.contractId).toBe("roof-job");
    expect(context.contractId).not.toBe("door-job");
    expectBlocked(
      ledger,
      QuickDraftSchema.parse({ ...context, amount: "700" }),
    );
  });
  it("keeps an explicitly selected archived notebook ID until saving can report the removed record", () => {
    const ledger = setEntityRemoved(
      fixture(),
      "work",
      "door",
      true,
      undefined,
      at,
    );
    const context = entryContext(ledger, {
      kind: "payment",
      personId: "worker",
      workId: "door",
    });
    expect(context.workId).toBe("door");
    expectBlocked(
      ledger,
      QuickDraftSchema.parse({ ...context, amount: "700" }),
    );
  });
  it("creates a fresh general notebook instead of inferring an archived general notebook", () => {
    const initial = LedgerSchema.parse({
      ...fixture(),
      works: [...fixture().works, { id: "old-general", name: "সাধারণ খরচ" }],
    });
    const ledger = setEntityRemoved(
      initial,
      "work",
      "old-general",
      true,
      undefined,
      at,
    );
    const before = structuredClone(ledger);
    const next = buildQuickEntry(
      ledger,
      QuickDraftSchema.parse({ ...transaction("expense"), workId: "" }),
    );
    const activeGeneral = next.works.find(
      (work) => work.name === "সাধারণ খরচ" && !work.archivedAt,
    );
    expect(activeGeneral?.id).toBe("general-new-expense");
    expect(
      next.entries.find((entry) => entry.id === "new-expense")?.lines[0].workId,
    ).toBe(activeGeneral?.id);
    expect(
      next.works.find((work) => work.id === "old-general")?.archivedAt,
    ).toBe(at);
    expect(ledger).toEqual(before);
  });
  it("reuses an active general notebook even when an archived notebook has the same name", () => {
    const initial = LedgerSchema.parse({
      ...fixture(),
      works: [
        ...fixture().works,
        { id: "old-general", name: "সাধারণ খরচ" },
        { id: "current-general", name: "সাধারণ খরচ" },
      ],
    });
    const ledger = setEntityRemoved(
      initial,
      "work",
      "old-general",
      true,
      undefined,
      at,
    );
    const before = structuredClone(ledger);
    const next = buildQuickEntry(
      ledger,
      QuickDraftSchema.parse({ ...transaction("expense"), workId: "" }),
    );
    expect(
      next.entries.find((entry) => entry.id === "new-expense")?.lines[0].workId,
    ).toBe("current-general");
    expect(next.works).toHaveLength(before.works.length);
    expect(ledger).toEqual(before);
  });
  it("allows a restored job to receive payments again while retaining its removal history", () => {
    const archived = setEntityRemoved(
      fixture(),
      "contract",
      "door-job",
      true,
      undefined,
      at,
    );
    const restored = setEntityRemoved(
      archived,
      "contract",
      "door-job",
      false,
      undefined,
      "2026-11-02T06:30:00Z",
    );
    expect(
      applicableQuickContracts(restored, "worker", "door").map((job) => job.id),
    ).toEqual(["door-job"]);
    const next = buildQuickEntry(restored, payment());
    expect(
      next.contracts.find((job) => job.id === "door-job")?.removalHistory,
    ).toEqual(
      restored.contracts.find((job) => job.id === "door-job")?.removalHistory,
    );
    expect(
      next.contracts.find((job) => job.id === "door-job")?.removalHistory,
    ).toHaveLength(2);
    expect(contractSummary(next, "door-job")).toMatchObject({
      netPaid: 70000,
      remaining: 530000,
    });
  });
  it("keeps active payments usable and preserves all historical money for unrelated archived records", () => {
    let ledger = setEntityRemoved(
      fixture(),
      "work",
      "roof",
      true,
      undefined,
      at,
    );
    ledger = setEntityRemoved(
      ledger,
      "contract",
      "roof-job",
      true,
      undefined,
      at,
    );
    ledger = setEntityRemoved(ledger, "person", "shop", true, undefined, at);
    const before = structuredClone(ledger);
    const next = buildQuickEntry(ledger, payment());
    expect(next.entries.slice(0, before.entries.length)).toEqual(
      before.entries,
    );
    expect(next.entries).toHaveLength(before.entries.length + 1);
    expect(next.entries.at(-1)).toMatchObject({
      id: "new-payment",
      kind: "payment",
      personId: "worker",
      contractId: "door-job",
      account: "labour",
      allocations: [{ workId: "door", amount: 70000 }],
    });
    expect(summarize(before)).toMatchObject({ cost: 300000, paid: 125000 });
    expect(summarize(next)).toMatchObject({ cost: 300000, paid: 195000 });
    expect(contractSummary(next, "door-job")).toMatchObject({
      netPaid: 70000,
      remaining: 530000,
    });
    expect(ledger).toEqual(before);
  });
});

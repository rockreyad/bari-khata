import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { EntrySchema, LedgerSchema, type Ledger } from "../../domain/model";
import { personSummary, summarize, contractSummary } from "../../domain/ledger";
import {
  costRows,
  filterCostRows,
  summarizeRows,
} from "../analytics/analytics";
import {
  QuickDraftSchema,
  QuickSavedDraftSchema,
  buildQuickEntry,
  validQuickDate,
} from "./quickEntry";
import { getAccountDatabase, setActiveOwner } from "../../data/database";
import {
  createWorkspaceStorage,
  getScopedRepository,
} from "../../data/repository";

function fixture(): Ledger {
  return LedgerSchema.parse({
    works: [
      { id: "tiles", name: "টাইলস" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "worker", name: "মিস্ত্রি", kind: "worker" },
      { id: "shop", name: "দোকান", kind: "shop" },
      { id: "driver", name: "ভ্যানচালক", kind: "driver" },
    ],
    materialGroups: [
      { id: "cement", name: "সিমেন্ট" },
      { id: "sand", name: "বালু" },
    ],
  });
}
function draft(change: Record<string, unknown> = {}) {
  return QuickDraftSchema.parse({
    id: crypto.randomUUID(),
    paymentId: crypto.randomUUID(),
    refundId: crypto.randomUUID(),
    personNewId: crypto.randomUUID(),
    date: "2026-11-01",
    workId: "tiles",
    rows: [{ id: crypto.randomUUID(), label: "টাইলস", amount: "1500" }],
    ...change,
  });
}
function purchase(ledger: Ledger, amount: string, payment: string = "full") {
  return buildQuickEntry(
    ledger,
    draft({
      personId: "shop",
      payment,
      rows: [{ id: crypto.randomUUID(), label: "মাল", amount }],
    }),
  );
}

describe("quick homeowner entries", () => {
  it("records a minimal fully paid purchase without a person and never creates an anonymous due", () => {
    const input = draft({ workId: "" });
    const next = buildQuickEntry(fixture(), input);
    expect(next.entries).toHaveLength(2);
    expect(next.entries[1].relatedEntryId).toBe(next.entries[0].id);
    expect(next.entries[0].personId).toBeNull();
    expect(summarize(next)).toMatchObject({
      cost: 150000,
      paid: 150000,
      payable: 0,
      advance: 0,
    });
    expect(next.works.find((work) => work.name === "সাধারণ খরচ")).toBeDefined();
    expect(
      next.works.find((work) => work.name === "সাধারণ খরচ")?.activity,
    ).toHaveLength(1);
    expect(() => buildQuickEntry(next, input)).toThrow("duplicate");
  });

  it("can still read an old worker material voucher and reimbursement without deleting or reclassifying them", () => {
    const old = fixture();
    old.entries.push(
      EntrySchema.parse({
        id: "legacy-voucher",
        kind: "expense",
        account: "materials",
        personId: "worker",
        date: "2026-10-01",
        lines: [
          {
            id: "legacy-material",
            workId: "tiles",
            label: "মিস্ত্রি নিজের টাকায় মাল কিনেছেন",
            costType: "material",
            amount: 150000,
          },
        ],
      }),
      EntrySchema.parse({
        id: "legacy-repayment",
        kind: "payment",
        account: "materials",
        personId: "worker",
        relatedEntryId: "legacy-voucher",
        date: "2026-10-02",
        allocations: [{ workId: "tiles", amount: 170000 }],
        paymentParts: [{ method: "bkash", amount: 170000 }],
      }),
    );
    const snapshot = JSON.parse(JSON.stringify(old));
    const restored = LedgerSchema.parse(snapshot);
    expect(restored.entries.map((entry) => entry.id)).toEqual([
      "legacy-voucher",
      "legacy-repayment",
    ]);
    expect(
      restored.entries.every((entry) => entry.account === "materials"),
    ).toBe(true);
    expect(personSummary(restored, "worker")).toMatchObject({
      cost: 150000,
      paid: 170000,
      payable: 0,
      advance: 20000,
    });
    expect(summarize(restored).byType.labour).toBe(0);
    expect(snapshot).toEqual(JSON.parse(JSON.stringify(old)));
    const procured = buildQuickEntry(
      restored,
      draft({ personId: "worker", payment: "worker" }),
    );
    expect(procured.entries.slice(0, 2)).toEqual(restored.entries);
    expect(procured.entries).toHaveLength(3);
    expect(procured.entries[2]).toMatchObject({
      kind: "expense",
      account: "materials",
      personId: "worker",
    });
    expect(summarize(procured)).toMatchObject({
      cost: 300000,
      paid: 170000,
      payable: 130000,
    });
    expect(summarize(procured).byType.labour).toBe(0);
    expect(restored.entries).toHaveLength(2);
  });

  it("balances a shop's paid purchase, credit purchase, returned goods and later independent cash refund", () => {
    let next = purchase(fixture(), "10000");
    next = purchase(next, "3000", "due");
    expect(personSummary(next, "shop").payable).toBe(300000);
    next = buildQuickEntry(
      next,
      draft({
        kind: "return",
        personId: "shop",
        rows: [{ id: crypto.randomUUID(), label: "ফেরত মাল", amount: "5000" }],
      }),
    );
    expect(personSummary(next, "shop")).toMatchObject({
      cost: 800000,
      advance: 200000,
      payable: 0,
    });
    const oldCosts = next.entries.filter(
      (entry) => entry.kind === "expense" || entry.kind === "expense_credit",
    ).length;
    next = buildQuickEntry(
      next,
      draft({
        kind: "refund",
        personId: "shop",
        amount: "2000",
        account: "materials",
      }),
    );
    expect(next.entries.at(-1)).toMatchObject({
      kind: "refund",
      lines: [],
      account: "materials",
    });
    expect(
      next.entries.filter(
        (entry) => entry.kind === "expense" || entry.kind === "expense_credit",
      ),
    ).toHaveLength(oldCosts);
    expect(personSummary(next, "shop")).toMatchObject({
      cost: 800000,
      netPaid: 800000,
      payable: 0,
      advance: 0,
    });
  });

  it("settles the selected wage agreement without adding another wage bill", () => {
    const initial = fixture();
    initial.contracts.push({
      id: "agreement",
      workId: "tiles",
      personId: "worker",
      title: "টাইলস বসানো",
      basis: "fixed",
      quantity: "1",
      rate: 500000,
      total: 500000,
      notes: "",
      scope: "work",
      status: null,
      archivedAt: null,
      removalHistory: [],
      agreedOn: null,
      activity: [],
      history: [],
    });
    let next = buildQuickEntry(
      initial,
      draft({
        personId: "worker",
        costType: "labour",
        payment: "due",
        contractId: "agreement",
      }),
    );
    next = buildQuickEntry(
      next,
      draft({
        kind: "payment",
        personId: "worker",
        amount: "1500",
        account: "labour",
        contractId: "agreement",
      }),
    );
    expect(summarize(next)).toMatchObject({
      cost: 150000,
      paid: 150000,
      payable: 0,
      advance: 0,
    });
    expect(next.entries[1]).toMatchObject({
      kind: "payment",
      account: "labour",
      contractId: "agreement",
      lines: [],
    });
    expect(() =>
      buildQuickEntry(
        next,
        draft({
          kind: "payment",
          personId: "worker",
          workId: "roof",
          amount: "1",
          account: "labour",
          contractId: "agreement",
        }),
      ),
    ).toThrow("contract");
  });

  it("keeps unloading tied to the right material group without counting it as material price", () => {
    const next = buildQuickEntry(
      fixture(),
      draft({
        costType: "unload",
        rows: [
          {
            id: "cement-fee",
            label: "সিমেন্ট নামানো",
            amount: "150",
            groupId: "cement",
            brand: "Crown",
          },
          {
            id: "sand-fee",
            label: "বালু নামানো",
            amount: "250",
            groupId: "sand",
          },
        ],
      }),
    );
    expect(summarize(next)).toMatchObject({
      cost: 40000,
      paid: 40000,
      byType: { material: 0, unload: 40000 },
    });
    expect(
      summarizeRows(
        filterCostRows(costRows(next), {
          groupId: "cement",
          costType: "unload",
        }),
      ).total,
    ).toBe(15000);
    expect(
      summarizeRows(
        filterCostRows(costRows(next), { groupId: "sand", costType: "unload" }),
      ).total,
    ).toBe(25000);
  });

  it("adds future material groups and brands and reuses a group entered again", () => {
    let next = buildQuickEntry(
      fixture(),
      draft({
        rows: [
          {
            id: "wood",
            label: "দরজার কাঠ",
            amount: "2500",
            groupId: "__new__",
            groupName: "কাঠ",
            brand: "নতুন ব্র্যান্ড",
          },
        ],
      }),
    );
    const group = next.materialGroups.find((group) => group.name === "কাঠ")!;
    expect(next.items.find((item) => item.name === "দরজার কাঠ")).toMatchObject({
      materialGroupId: group.id,
      brand: "নতুন ব্র্যান্ড",
    });
    next = buildQuickEntry(
      next,
      draft({
        rows: [
          {
            id: "wood2",
            label: "জানালার কাঠ",
            amount: "1000",
            groupId: "__new__",
            groupName: " কাঠ ",
          },
        ],
      }),
    );
    expect(
      next.materialGroups.filter((group) => group.name === "কাঠ"),
    ).toHaveLength(1);
    expect(() =>
      buildQuickEntry(
        next,
        draft({
          rows: [
            { id: "missing", label: "মাল", amount: "1", groupId: "__new__" },
          ],
        }),
      ),
    ).toThrow("group");
  });

  it("rejects bad amounts and impossible dates without changing the original ledger", () => {
    const original = fixture();
    for (const amount of [
      "0",
      "-1",
      "1.001",
      "1e3",
      "999999999999999999999999",
    ]) {
      expect(() =>
        buildQuickEntry(
          original,
          draft({ rows: [{ id: "bad", label: "মাল", amount }] }),
        ),
      ).toThrow();
    }
    expect(() =>
      buildQuickEntry(original, draft({ date: "2026-02-30" })),
    ).toThrow("date");
    expect(validQuickDate("2024-02-29")).toBe(true);
    expect(validQuickDate("2026-02-29")).toBe(false);
    expect(original.entries).toHaveLength(0);
    expect(() => buildQuickEntry(original, draft({ payment: "due" }))).toThrow(
      "person",
    );
    expect(() =>
      buildQuickEntry(original, draft({ kind: "refund", amount: "100" })),
    ).toThrow("person");
  });

  it("validates restored draft vouchers and attaches a refund voucher only once", () => {
    const input = draft({ kind: "refund", personId: "shop", amount: "100" });
    const file = {
      id: "voucher",
      entryId: input.id,
      name: "voucher.png",
      file: new Blob(["receipt"], { type: "image/png" }),
    };
    expect(
      QuickSavedDraftSchema.safeParse({ draft: input, files: [file] }).success,
    ).toBe(true);
    expect(
      QuickSavedDraftSchema.safeParse({
        draft: input,
        files: [{ ...file, file: "untrusted" }],
      }).success,
    ).toBe(false);
    expect(
      QuickSavedDraftSchema.safeParse({
        draft: input,
        files: [{ ...file, entryId: "another-entry" }],
      }).success,
    ).toBe(false);
    expect(
      QuickSavedDraftSchema.safeParse({ draft: input, files: [file, file] })
        .success,
    ).toBe(false);
    expect(
      QuickSavedDraftSchema.safeParse({
        draft: input,
        files: [{ ...file, file: new Blob(["<html>"], { type: "text/html" }) }],
      }).success,
    ).toBe(false);
    const next = buildQuickEntry(fixture(), input, [
      {
        id: file.id,
        name: file.name,
        mime: file.file.type,
        size: file.file.size,
      },
    ]);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0].receipts).toHaveLength(1);
    expect(next.entries[0].kind).toBe("refund");
  });

  it("rejects a settlement without a work and keeps the pending draft and voucher", async () => {
    const owner = crypto.randomUUID();
    const database = getAccountDatabase(owner);
    setActiveOwner(owner);
    try {
      const repository = getScopedRepository();
      await repository.ensure("real", fixture());
      const storage = createWorkspaceStorage();
      const pending = draft({
        kind: "refund",
        personId: "shop",
        workId: "",
        amount: "2000",
      });
      const voucher = {
        id: "pending-voucher",
        entryId: pending.id,
        name: "refund.png",
        file: new Blob(["refund receipt"], { type: "image/png" }),
      };
      await storage.saveDraft("pending", { draft: pending, files: [voucher] });
      await expect(
        repository.save((current) => buildQuickEntry(current, pending)),
      ).rejects.toThrow("work");
      expect(() =>
        buildQuickEntry(
          fixture(),
          draft({
            kind: "payment",
            personId: "worker",
            workId: "",
            amount: "1500",
          }),
        ),
      ).toThrow("work");
      const restored = QuickSavedDraftSchema.parse(
        await storage.readDraft("pending"),
      );
      expect(restored.draft).toMatchObject({
        id: pending.id,
        kind: "refund",
        amount: "2000",
        workId: "",
        personId: "shop",
      });
      expect(await restored.files[0].file.text()).toBe("refund receipt");
      expect((await repository.read())?.ledger.entries).toHaveLength(0);
    } finally {
      setActiveOwner(null);
      await database.delete();
    }
  });
});

describe("explicit financial events independent of contact identity", () => {
  it("keeps a worker's material purchase, transport and returns in the explicitly selected financial category", () => {
    const initial = fixture();
    const before = JSON.stringify(initial);
    for (const change of [
      { kind: "expense", personId: "worker", costType: "material" },
      { kind: "expense", personId: "worker", costType: "transport" },
      { kind: "return", personId: "worker", costType: "material" },
    ]) {
      const next = buildQuickEntry(initial, draft(change));
      expect(next.entries[0]).toMatchObject({
        kind: change.kind === "return" ? "expense_credit" : "expense",
        account: change.costType === "transport" ? "other" : "materials",
        personId: "worker",
        lines: [{ amount: 150000, costType: change.costType }],
      });
      expect(
        next.entries.filter((entry) => entry.kind === "payment"),
      ).toHaveLength(change.kind === "return" ? 0 : 1);
      expect(next.people).toEqual(initial.people);
      expect(summarize(next).byType.labour).toBe(0);
    }
    expect(JSON.stringify(initial)).toBe(before);
    const next = buildQuickEntry(
      initial,
      draft({
        personId: "worker",
        costType: "labour",
        payment: "due",
        rows: [{ id: "labour", label: "টাইলস বসানো", amount: "1500" }],
      }),
    );
    expect(next.entries[0]).toMatchObject({
      account: "labour",
      kind: "expense",
      lines: [{ costType: "labour", amount: 150000 }],
    });
    expect(personSummary(next, "worker").payable).toBe(150000);
  });

  it("records a labour bill only when explicitly requested for a shop identity", () => {
    const initial = fixture();
    for (const change of [
      { kind: "expense", personId: "shop", costType: "labour" },
      { kind: "wage", personId: "shop", amount: "500" },
      { kind: "payment", purpose: "wage", personId: "shop", amount: "500" },
    ]) {
      const next = buildQuickEntry(initial, draft(change));
      const amount = change.kind === "expense" ? 150000 : 50000;
      expect(next.entries[0]).toMatchObject({
        kind: "expense",
        account: "labour",
        lines: [{ costType: "labour", amount }],
      });
      expect(summarize(next)).toMatchObject({
        cost: amount,
        paid: amount,
        payable: 0,
        advance: 0,
      });
      expect(next.people).toEqual(initial.people);
    }
    expect(initial.entries).toHaveLength(0);
  });

  it("keeps a driver's transport and payments in the transport account", () => {
    let next = buildQuickEntry(
      fixture(),
      draft({
        personId: "driver",
        costType: "transport",
        payment: "due",
        rows: [{ id: "van", label: "গোডাউন থেকে দরজা আনা", amount: "500" }],
      }),
    );
    expect(next.entries[0]).toMatchObject({
      account: "other",
      personId: "driver",
      lines: [{ costType: "transport", workId: "tiles" }],
    });
    next = buildQuickEntry(
      next,
      draft({
        kind: "payment",
        personId: "driver",
        account: "other",
        amount: "500",
      }),
    );
    expect(personSummary(next, "driver")).toMatchObject({
      cost: 50000,
      paid: 50000,
      payable: 0,
      advance: 0,
    });
    for (const change of [
      { kind: "expense", personId: "driver", costType: "material" },
      { kind: "expense", personId: "driver", costType: "labour" },
      { kind: "expense", personId: "driver", costType: "unload" },
      { kind: "expense", personId: "driver", costType: "rental" },
      { kind: "return", personId: "driver", costType: "transport" },
    ]) {
      const explicit = buildQuickEntry(next, draft(change));
      expect(explicit.entries.slice(0, next.entries.length)).toEqual(
        next.entries,
      );
      expect(explicit.entries[next.entries.length]).toMatchObject({
        kind: change.kind === "return" ? "expense_credit" : "expense",
        account:
          change.costType === "material"
            ? "materials"
            : change.costType === "labour"
              ? "labour"
              : "other",
        personId: "driver",
        lines: [{ amount: 150000, costType: change.costType }],
      });
      expect(explicit.people).toEqual(next.people);
    }
  });

  it("records a paid van fee under its work without requiring a driver contact", () => {
    const initial = fixture();
    const next = buildQuickEntry(
      initial,
      draft({
        workId: "roof",
        personId: "",
        costType: "transport",
        rows: [{ id: "van-fee", label: "রড আনার ভ্যানভাড়া", amount: "300" }],
      }),
    );
    expect(next.people).toEqual(initial.people);
    expect(next.entries).toHaveLength(2);
    expect(next.entries[0]).toMatchObject({
      personId: null,
      account: "other",
      lines: [{ workId: "roof", costType: "transport", amount: 30000 }],
    });
    expect(next.entries[1]).toMatchObject({
      personId: null,
      kind: "payment",
      account: "other",
      relatedEntryId: next.entries[0].id,
      allocations: [{ workId: "roof", amount: 30000 }],
    });
    expect(summarize(next, "roof")).toMatchObject({
      cost: 30000,
      paid: 30000,
      payable: 0,
      advance: 0,
      byType: { material: 0, labour: 0, transport: 30000 },
    });
    expect(summarize(next, "tiles").cost).toBe(0);
  });

  it("settles shop materials and worker wages independently without a mixed cash record", () => {
    let next = purchase(fixture(), "5000", "due");
    next = buildQuickEntry(
      next,
      draft({
        personId: "worker",
        costType: "labour",
        payment: "due",
        rows: [{ id: "wage", label: "টাইলস বসানো", amount: "1500" }],
      }),
    );
    next = buildQuickEntry(
      next,
      draft({
        kind: "payment",
        personId: "worker",
        account: "labour",
        amount: "1000",
      }),
    );
    expect(personSummary(next, "worker").payable).toBe(50000);
    expect(personSummary(next, "shop").payable).toBe(500000);
    next = buildQuickEntry(
      next,
      draft({
        kind: "payment",
        personId: "shop",
        account: "materials",
        amount: "2000",
      }),
    );
    expect(personSummary(next, "worker").payable).toBe(50000);
    expect(personSummary(next, "shop").payable).toBe(300000);
    expect(
      next.entries
        .filter((entry) => entry.kind === "payment")
        .map((entry) => [entry.personId, entry.account]),
    ).toEqual([
      ["worker", "labour"],
      ["shop", "materials"],
    ]);
    expect(
      next.entries
        .filter((entry) => entry.kind === "payment")
        .every((entry) => entry.lines.length === 0),
    ).toBe(true);
    expect(summarize(next).byType).toMatchObject({
      material: 500000,
      labour: 150000,
    });
  });

  it("keeps two door shops and their van fees separate by supplier and work", () => {
    const initial = LedgerSchema.parse({
      works: [
        { id: "bedroom", name: "শোবার ঘরের দরজা" },
        { id: "bathroom", name: "বাথরুমের দরজা" },
      ],
      people: [
        { id: "bed-shop", name: "কাঠের দরজার দোকান", kind: "shop" },
        { id: "bath-shop", name: "বাথরুমের দরজার দোকান", kind: "shop" },
      ],
      materialGroups: [{ id: "door", name: "দরজা" }],
    });
    let next = buildQuickEntry(
      initial,
      draft({
        workId: "bedroom",
        personId: "bed-shop",
        payment: "partial",
        paid: "5000",
        rows: [
          {
            id: "bed-door",
            label: "শোবার ঘরের দরজা",
            amount: "20000",
            groupId: "door",
          },
        ],
      }),
    );
    next = buildQuickEntry(
      next,
      draft({
        workId: "bathroom",
        personId: "bath-shop",
        rows: [
          {
            id: "bath-door",
            label: "বাথরুমের দরজা",
            amount: "12000",
            groupId: "door",
          },
        ],
      }),
    );
    next = buildQuickEntry(
      next,
      draft({
        workId: "bedroom",
        personId: "",
        costType: "transport",
        rows: [
          {
            id: "door-van",
            label: "দরজা আনার ভ্যানভাড়া",
            amount: "300",
            groupId: "door",
          },
        ],
      }),
    );
    next = buildQuickEntry(
      next,
      draft({
        workId: "bedroom",
        personId: "bed-shop",
        kind: "return",
        rows: [
          {
            id: "door-return",
            label: "অব্যবহৃত দরজার মাল",
            amount: "2000",
            groupId: "door",
          },
        ],
      }),
    );
    expect(personSummary(next, "bed-shop")).toMatchObject({
      cost: 1800000,
      paid: 500000,
      payable: 1300000,
      advance: 0,
    });
    expect(personSummary(next, "bath-shop")).toMatchObject({
      cost: 1200000,
      paid: 1200000,
      payable: 0,
      advance: 0,
    });
    expect(summarize(next, "bedroom").byType).toMatchObject({
      material: 1800000,
      transport: 30000,
      labour: 0,
    });
    expect(summarize(next, "bathroom").byType).toMatchObject({
      material: 1200000,
      transport: 0,
      labour: 0,
    });
    expect(next.people).toEqual(initial.people);
  });

  it("assigns a newly named worker from the selected wage purpose without treating them as a shop", () => {
    const next = buildQuickEntry(
      fixture(),
      draft({
        kind: "payment",
        purpose: "wage",
        personId: "__new__",
        personName: "করিম",
        personNewId: "new-worker",
        amount: "500",
      }),
    );
    expect(next.people.find((person) => person.id === "new-worker")?.kind).toBe(
      "worker",
    );
    expect(next.entries).toHaveLength(2);
    expect(next.entries.every((entry) => entry.account === "labour")).toBe(
      true,
    );
    expect(
      next.entries.find((entry) => entry.kind === "expense")?.lines[0].costType,
    ).toBe("labour");
  });
  it("honours an unpaid or partial wage bill without silently paying the full bill", () => {
    for (const [payment, paid, cash] of [
      ["due", "", 0],
      ["partial", "3000", 300000],
    ] as const) {
      const next = buildQuickEntry(
        fixture(),
        draft({
          kind: "wage",
          personId: "worker",
          amount: "16000",
          payment,
          paid,
        }),
      );
      expect(summarize(next, "tiles")).toMatchObject({
        cost: 1600000,
        paid: cash,
      });
      expect(personSummary(next, "worker")).toMatchObject({
        payable: 1600000 - cash,
      });
      expect(
        next.entries.filter((entry) => entry.kind === "payment"),
      ).toHaveLength(payment === "due" ? 0 : 1);
    }
  });
});

describe("canonical numeric drafts and old English records", () => {
  it.each(["162", "১৬২", "1৬2"])(
    "keeps %s taka as 16200 paisa, then adds a new bill without rescaling the old one",
    (amount) => {
      const old = purchase(fixture(), "162");
      const restored = LedgerSchema.parse(JSON.parse(JSON.stringify(old)));
      const next = buildQuickEntry(
        restored,
        draft({
          personId: "shop",
          rows: [
            {
              id: crypto.randomUUID(),
              label: "নতুন মাল",
              amount,
              quantity: "৮",
            },
          ],
        }),
      );
      expect(
        next.entries
          .filter((entry) => entry.kind === "expense")
          .map((entry) => entry.lines[0].amount),
      ).toEqual([16200, 16200]);
      expect(next.entries.at(-2)!.lines[0].quantity).toBe("8");
      expect(summarize(next)).toMatchObject({
        cost: 32400,
        paid: 32400,
        payable: 0,
        advance: 0,
      });
      expect(old.entries[0].lines[0].amount).toBe(16200);
    },
  );
  it("rehydrates a Bengali draft to ASCII fields and saves a 93000 bill with 30000 paid exactly", () => {
    const saved = QuickSavedDraftSchema.parse({
      draft: draft({
        personId: "shop",
        payment: "partial",
        paid: "৩০০০০",
        amount: "৯৩০০০",
        refund: "০",
        rows: [
          {
            id: crypto.randomUUID(),
            label: "দরজা",
            amount: "৯৩০০০",
            quantity: "৮",
          },
        ],
      }),
    });
    expect(saved.draft).toMatchObject({
      amount: "93000",
      paid: "30000",
      refund: "0",
    });
    expect(saved.draft.rows[0]).toMatchObject({
      amount: "93000",
      quantity: "8",
    });
    const next = buildQuickEntry(fixture(), saved.draft);
    expect(summarize(next)).toMatchObject({
      cost: 9300000,
      paid: 3000000,
      payable: 6300000,
      advance: 0,
    });
  });
  it("rejects an unsafe new bill instead of corrupting the existing ledger", () => {
    const old = purchase(fixture(), "162");
    const before = JSON.stringify(old);
    expect(() => purchase(old, "90071992547409.92")).toThrow();
    expect(JSON.stringify(old)).toBe(before);
  });
});

it("reuses a digit-equivalent legacy material instead of creating a duplicate or rewriting its saved name", () => {
  const initial = fixture();
  const ledger = LedgerSchema.parse({
    ...initial,
    materialGroups: [...initial.materialGroups, { id: "rod-16", name: "রড" }],
    items: [
      {
        id: "legacy-rod-16",
        name: "Rod ১৬ mm",
        materialGroupId: "rod-16",
        brand: "Grade ৬০",
        usage: "Door ২",
        unit: "kg",
      },
    ],
  });
  const before = structuredClone(ledger.items);
  const saved = buildQuickEntry(
    ledger,
    draft({
      personId: "shop",
      rows: [
        {
          id: "new-rod-line",
          label: "Rod 16 mm",
          groupId: "rod-16",
          brand: "Grade 60",
          usage: "Door 2",
          unit: "kg",
          quantity: "8",
          amount: "162",
        },
      ],
    }),
  );
  expect(saved.items).toEqual(before);
  expect(saved.entries[0].lines[0]).toMatchObject({
    itemId: "legacy-rod-16",
    label: "Rod 16 mm",
    amount: 16200,
    materialGroupId: "rod-16",
  });
  expect(ledger.items).toEqual(before);
});

it.each([false, true])(
  "records an unlinked job payment in the general notebook without changing another job (existing general: %s)",
  (hasGeneral) => {
    const ledger = LedgerSchema.parse({
      ...fixture(),
      works: [
        ...fixture().works,
        ...(hasGeneral ? [{ id: "general", name: "সাধারণ খরচ" }] : []),
      ],
      contracts: [
        { id: "house", scope: "house", personId: "worker", total: 2000000 },
        {
          id: "other-job",
          scope: "house",
          personId: "worker",
          total: 60000000,
        },
      ],
    });
    const before = JSON.stringify(ledger);
    const next = buildQuickEntry(
      ledger,
      draft({
        kind: "payment",
        personId: "worker",
        account: "labour",
        costType: "labour",
        contractId: "house",
        workId: "",
        amount: "5000",
      }),
    );
    const general = next.works.find((work) => work.name === "সাধারণ খরচ")!;
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({
      kind: "payment",
      contractId: "house",
      allocations: [{ workId: general.id, amount: 500000 }],
    });
    expect(contractSummary(next, "house")).toMatchObject({
      netPaid: 500000,
      remaining: 1500000,
    });
    expect(contractSummary(next, "other-job").netPaid).toBe(0);
    expect(summarize(next).cost).toBe(0);
    expect(JSON.stringify(ledger)).toBe(before);
  },
);
it("still requires a notebook for unrelated cash and a notebook-specific job", () => {
  const ledger = LedgerSchema.parse({
    ...fixture(),
    contracts: [
      { id: "specific", personId: "worker", workId: "tiles", total: 2000000 },
    ],
  });
  const before = JSON.stringify(ledger);
  for (const contractId of ["", "specific", "unknown"])
    expect(() =>
      buildQuickEntry(
        ledger,
        draft({
          kind: "payment",
          personId: "worker",
          account: "labour",
          contractId,
          workId: "",
          amount: "5000",
        }),
      ),
    ).toThrow("work");
  expect(JSON.stringify(ledger)).toBe(before);
});

it.each(["worker", "shop", "driver"] as const)(
  "keeps an explicit cash settlement in its selected account after identity becomes %s",
  (kind) => {
    const original = fixture();
    original.people[0].kind = kind;
    for (const account of ["materials", "labour", "other"] as const) {
      const next = buildQuickEntry(
        original,
        draft({
          kind: "payment",
          personId: original.people[0].id,
          account,
          amount: "100",
        }),
      );
      expect(next.entries).toHaveLength(1);
      expect(next.entries[0]).toMatchObject({
        kind: "payment",
        account,
        personId: original.people[0].id,
      });
      expect(next.entries[0].lines).toEqual([]);
      expect(next.people).toEqual(original.people);
    }
  },
);

it.each(["existing", "new"] as const)(
  "keeps a %s custom reason on a daily labour bill and its separate partial payment",
  (selection) => {
    const original = fixture();
    const purposeId = "sample-supervision";
    if (selection === "existing")
      original.paymentPurposes.push({
        id: purposeId,
        name: "নমুনা তদারকি",
        account: "labour",
      });
    const before = JSON.stringify(original);
    const next = buildQuickEntry(
      original,
      draft({
        kind: "payment",
        purpose: "wage",
        personId: "shop",
        account: "labour",
        costType: "labour",
        wageBasis: "day",
        wageDays: "2.5",
        wageRate: "300",
        payment: "partial",
        paid: "500",
        paymentPurposeId: selection === "existing" ? purposeId : "__new__",
        paymentPurposeNewId: purposeId,
        paymentPurposeName: selection === "existing" ? "" : "নমুনা তদারকি",
      }),
    );
    expect(next.paymentPurposes).toHaveLength(1);
    expect(next.entries).toHaveLength(2);
    expect(next.entries[0]).toMatchObject({
      kind: "expense",
      account: "labour",
      personId: "shop",
      paymentPurposeId: null,
      lines: [
        {
          amount: 75000,
          costType: "labour",
          label: "নমুনা তদারকি · 2.5 দিন × 300 টাকা",
          quantity: "2.5",
          unit: "দিন",
        },
      ],
    });
    expect(next.entries[1]).toMatchObject({
      kind: "payment",
      account: "labour",
      personId: "shop",
      relatedEntryId: next.entries[0].id,
      paymentPurposeId: purposeId,
      paymentParts: [{ amount: 50000 }],
    });
    expect(summarize(next)).toMatchObject({
      cost: 75000,
      paid: 50000,
      payable: 25000,
      advance: 0,
    });
    expect(JSON.stringify(original)).toBe(before);
  },
);

import {
  filterHistory,
  historyTitle,
  historySubtitle,
} from "../history/history";
import { describe, it, expect } from "vitest";
import { LedgerSchema } from "../../domain/model";
import { entryContext } from "./entryContext";
import { buildQuickEntry } from "./quickEntry";
import { summarize } from "../../domain/ledger";
describe("custom payment purposes", () => {
  const fixture = () =>
    LedgerSchema.parse({
      works: [{ id: "work", name: "কাজ" }],
      people: [{ id: "person", name: "শ্রমিক", kind: "other" }],
    });
  it("keeps a custom reason reusable under a stable account without adding any cost", () => {
    const ledger = fixture(),
      draft = entryContext(ledger, {
        kind: "payment",
        personId: "person",
        workId: "work",
        account: "other",
      });
    Object.assign(draft, {
      amount: "1500",
      paymentPurposeId: "__new__",
      paymentPurposeName: "মাল নামানোর টাকা",
    });
    const next = buildQuickEntry(ledger, draft);
    expect(next.paymentPurposes).toEqual([
      {
        id: draft.paymentPurposeNewId,
        name: "মাল নামানোর টাকা",
        account: "other",
      },
    ]);
    expect(next.entries[0]).toMatchObject({
      account: "other",
      paymentPurposeId: draft.paymentPurposeNewId,
    });
    expect(summarize(next)).toMatchObject({ cost: 0, paid: 150000 });
    const again = entryContext(next, {
      kind: "payment",
      personId: "person",
      workId: "work",
      account: "other",
    });
    Object.assign(again, {
      amount: "500",
      paymentPurposeId: draft.paymentPurposeNewId,
    });
    expect(buildQuickEntry(next, again).paymentPurposes).toHaveLength(1);
    expect(
      filterHistory(next, { query: "মাল নামানোর" }).map((entry) => entry.id),
    ).toEqual([draft.id]);
    expect(historyTitle(next, next.entries[0], true)).toBe("মাল নামানোর টাকা");
    expect(historySubtitle(next, next.entries[0])).toContain(
      "মাল নামানোর টাকা",
    );
  });
  it("rejects cross-account reasons and broken backup references", () => {
    const ledger = fixture();
    ledger.paymentPurposes.push({
      id: "wage",
      name: "মজুরি",
      account: "labour",
    });
    const draft = entryContext(ledger, {
      kind: "payment",
      personId: "person",
      workId: "work",
      account: "other",
    });
    Object.assign(draft, { amount: "10", paymentPurposeId: "wage" });
    expect(() => buildQuickEntry(ledger, draft)).toThrow("payment_purpose");
    expect(LedgerSchema.parse({}).paymentPurposes).toEqual([]);
  });
});

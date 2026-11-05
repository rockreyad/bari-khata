import { LedgerSchema } from "../model";

export function legacyArchitectureFixture() {
  return LedgerSchema.parse({
    works: [{ id: "w", name: "নমুনা কাজ" }],
    people: [
      {
        id: "p",
        name: "নমুনা ব্যক্তি",
        kind: "worker",
        contactType: "craftsperson",
      },
      { id: "duplicate", name: "নমুনা ব্যক্তি", role: "অস্পষ্ট কাজ" },
      { id: "shop", name: "নমুনা দোকান", kind: "shop" },
    ],
    entries: [
      {
        id: "bill",
        personId: "p",
        kind: "expense",
        account: "labour",
        date: "2025-01-01",
        note: "মূল বর্ণনা",
        lines: [{ id: "l", workId: "w", costType: "labour", amount: 10000 }],
      },
      {
        id: "paid",
        personId: "p",
        kind: "payment",
        account: "labour",
        date: "2025-01-02",
        allocations: [{ workId: "w", amount: 3000 }],
        paymentParts: [{ amount: 3000 }],
      },
      {
        id: "historical",
        kind: "expense",
        balanceImpact: "historical",
        reviewStatus: "needs_review",
        note: "নমুনা পুরোনো বর্ণনা",
        lines: [{ id: "hl", workId: "w", amount: 4000 }],
      },
    ],
  });
}

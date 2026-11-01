import { describe, it, expect } from "vitest";
import { LedgerSchema, PersonSchema } from "./model";
import { savePersonWithContract } from "./personContract";
import { summarize } from "./ledger";
describe("optional worker contract", () => {
  it("saves worker and fixed wage atomically without booking a cost or payment", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "plaster", name: "প্লাস্টার" }],
    });
    const next = savePersonWithContract(
      ledger,
      PersonSchema.parse({ id: "shah", name: "শাহ আলম", kind: "worker" }),
      { id: "agreement", workId: "plaster", amount: "৬০০০০০" },
    );
    expect(next.people).toHaveLength(1);
    expect(next.contracts[0]).toMatchObject({
      personId: "shah",
      total: 60000000,
      basis: "fixed",
      workId: "plaster",
    });
    expect(summarize(next)).toMatchObject({ cost: 0, paid: 0 });
    expect(ledger.people).toHaveLength(0);
  });
  it("needs valid work only when a contract is supplied and never creates one for a shop", () => {
    const ledger = LedgerSchema.parse({ works: [{ id: "work", name: "কাজ" }] });
    const shop = PersonSchema.parse({ id: "s", name: "দোকান", kind: "shop" });
    expect(savePersonWithContract(ledger, shop).contracts).toHaveLength(0);
    expect(() =>
      savePersonWithContract(ledger, shop, {
        id: "c",
        workId: "work",
        amount: "10",
      }),
    ).toThrow("contract");
    expect(ledger.people).toHaveLength(0);
  });
});

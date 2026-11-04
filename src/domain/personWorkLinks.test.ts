import { describe, expect, it } from "vitest";
import { LedgerSchema, PersonSchema } from "./model";
import { personKind } from "./contacts";
import { summarize } from "./ledger";
import { savePersonWithContract } from "./personContract";
import { personWorks, preservesPersonWorkLinks } from "./personWorkLinks";
import { appendBalanceAdjustment } from "./balanceAdjustments";

const fixture = () =>
  LedgerSchema.parse({
    works: [
      { id: "bathroom", name: "বাথরুম" },
      { id: "electric", name: "ইলেকট্রিক" },
    ],
    people: [{ id: "worker", name: "মোরশেদ", kind: "worker" }],
  });

describe("person notebook associations", () => {
  it("keeps old people valid and links one person to multiple notebooks without a cost, payment or contract", () => {
    const ledger = fixture();
    expect(ledger.people[0].workIds).toBeUndefined();
    const person = PersonSchema.parse({
      ...ledger.people[0],
      role: "ইঞ্জিনিয়ার",
      workIds: ["bathroom", "electric"],
    });
    const next = savePersonWithContract(ledger, person);
    expect(personWorks(next, person).map((work) => work.id)).toEqual([
      "bathroom",
      "electric",
    ]);
    expect(next.contracts).toEqual([]);
    expect(next.entries).toEqual([]);
    expect(summarize(next)).toMatchObject({ cost: 0, paid: 0 });
    expect(personKind(person)).toBe("worker");
    expect(ledger.people[0].workIds).toBeUndefined();
  });

  it.each([
    { workIds: ["missing"] },
    { workIds: ["bathroom", "bathroom"] },
    { workIds: [null] },
    { workIds: "bathroom" },
  ])("rejects invalid notebook links %j", ({ workIds }) => {
    const ledger = fixture();
    expect(() =>
      LedgerSchema.parse({
        ...ledger,
        people: [{ ...ledger.people[0], workIds }],
      }),
    ).toThrow();
  });

  it("keeps explicit clearing distinct from an old client omitting associations", () => {
    const before = fixture();
    before.people[0].workIds = ["bathroom", "electric"];
    expect(preservesPersonWorkLinks(before, fixture())).toBe(false);
    const after = fixture();
    after.people[0].workIds = [];
    expect(preservesPersonWorkLinks(before, after)).toBe(true);
    expect(preservesPersonWorkLinks(fixture(), after)).toBe(true);
  });

  it("also shows notebooks already linked through recorded work without assigning other people", () => {
    const ledger = LedgerSchema.parse({
      ...fixture(),
      people: [
        { id: "worker", name: "মোরশেদ", kind: "worker", workIds: ["bathroom"] },
        { id: "other", name: "অন্য মিস্ত্রি", kind: "worker" },
      ],
      entries: [
        {
          id: "paid",
          kind: "payment",
          personId: "worker",
          account: "labour",
          allocations: [{ workId: "electric", amount: 10000 }],
          paymentParts: [{ amount: 10000 }],
        },
      ],
    });
    expect(personWorks(ledger, ledger.people[0])).toHaveLength(2);
    expect(personWorks(ledger, ledger.people[1])).toEqual([]);
  });

  it("keeps a person's notebook reachable when its only record is a scoped adjustment", () => {
    const ledger = appendBalanceAdjustment(fixture(), {
      target: "person",
      personId: "worker",
      account: "labour",
      workId: "electric",
      basis: "paid",
      expectedBefore: 0,
      after: 10000,
      reason: "নমুনা খাতার দেওয়া মোট মিলিয়েছি",
    });
    expect(
      personWorks(ledger, ledger.people[0]).map((work) => work.id),
    ).toEqual(["electric"]);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].kind).toBe("adjustment");
    expect(summarize(ledger, "electric").paid).toBe(0);
  });
});

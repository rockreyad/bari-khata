import { describe, expect, it } from "vitest";
import { LedgerSchema, PersonSchema } from "../../domain/model";
import {
  contactSummary,
  matchesContact,
  personKind,
  phoneLink,
} from "./people";

describe("contact accounts", () => {
  it("creates safe call links for Bengali mobile numbers and shop landlines", () => {
    expect(phoneLink("০১৭১২ ৩৪৫৬৭৮")).toBe("tel:+8801712345678");
    expect(phoneLink("+880 (1712) 345-678")).toBe("tel:+8801712345678");
    expect(phoneLink("02-1234567")).toBe("tel:021234567");
    expect(phoneLink("javascript:01712345678")).toBeNull();
    expect(phoneLink("*247#")).toBeNull();
    expect(phoneLink("01712345678;123")).toBeNull();
  });
  it("keeps payable and advance separate while preserving unknown historical balances", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "tiles", name: "টাইলস" }],
      people: [{ id: "worker", name: "মিস্ত্রি" }],
      entries: [
        {
          id: "old",
          kind: "expense",
          personId: "worker",
          balanceImpact: "historical",
          lines: [{ id: "old-line", workId: "tiles", amount: 900000 }],
        },
        {
          id: "bought",
          kind: "expense",
          personId: "worker",
          account: "materials",
          lines: [{ id: "materials", workId: "tiles", amount: 150000 }],
        },
        {
          id: "repaid",
          kind: "payment",
          personId: "worker",
          account: "materials",
          allocations: [{ workId: "tiles", amount: 170000 }],
          paymentParts: [{ amount: 170000 }],
        },
        {
          id: "wage",
          kind: "expense",
          personId: "worker",
          account: "labour",
          lines: [
            {
              id: "wage-line",
              workId: "tiles",
              costType: "labour",
              amount: 50000,
            },
          ],
        },
      ],
    });
    expect(contactSummary(ledger, "worker")).toMatchObject({
      payable: 50000,
      advance: 20000,
      historicalCost: 900000,
      historicalCount: 1,
      currentCount: 3,
      cost: 1100000,
    });
  });
  it("finds people by role and Bengali digits without requiring a rigid contact category", () => {
    const shop = PersonSchema.parse({
      id: "shop",
      name: "সুন্দর হার্ডওয়্যার",
      phone: "01712345678",
    });
    expect(personKind(shop)).toBe("shop");
    expect(
      personKind(
        PersonSchema.parse({
          id: "worker",
          name: "রহিম",
          role: "টাইলস মিস্ত্রি",
        }),
      ),
    ).toBe("worker");
    expect(matchesContact(shop, "হার্ডওয়্যার ০১৭১২")).toBe(true);
  });
});

import { expect, it } from "vitest";
import { ContractSchema } from "./model";
import { legacyArchitectureFixture } from "./testing/legacyArchitecture";
import { createMigrationReview } from "./migrationReview";

it("bridges commitment-based legacy dues into earned dues and future commitment without inventing any source event", () => {
  const ledger = legacyArchitectureFixture();
  ledger.entries = ledger.entries.slice(0, 2);
  ledger.contracts = [
    ContractSchema.parse({
      id: "c",
      workId: "w",
      personId: "p",
      title: "নমুনা চুক্তি",
      total: 100000,
    }),
  ];
  ledger.entries[0].lines[0].amount = 30000;
  ledger.entries[1].allocations[0].amount = 10000;
  ledger.entries[1].paymentParts[0].amount = 10000;
  ledger.entries.forEach((entry) => {
    entry.contractId = "c";
  });
  const source = structuredClone(ledger);
  const report = createMigrationReview(ledger);
  expect(report.contracts[0]).toMatchObject({
    agreed: 100000,
    earned: 30000,
    legacyPayable: 90000,
    earnedPayable: 20000,
    unearnedCommitment: 70000,
  });
  expect(report.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "unclassified_cash",
        entityIds: ["paid"],
      }),
      expect.objectContaining({
        code: "contract_commitment_bridge",
        severity: "information",
      }),
    ]),
  );
  expect(ledger).toEqual(source);
});

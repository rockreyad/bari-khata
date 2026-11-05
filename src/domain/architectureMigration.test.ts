import { describe, expect, it } from "vitest";
import { legacyArchitectureFixture } from "./testing/legacyArchitecture";
import {
  migrateArchitecture,
  preservesArchitecture,
} from "./architectureMigration";

describe("versioned architecture migration", () => {
  it("preserves every financial event and reconciles project, party, account and sector totals without guessing", () => {
    const original = legacyArchitectureFixture();
    const migration = migrateArchitecture(original);
    expect(migration.changed).toBe(true);
    expect(migration.ledger.architectureVersion).toBe(2);
    expect(migration.ledger.people[0].roles).toEqual(["craftsperson"]);
    expect(migration.ledger.people[1].roles).toEqual([]);
    expect(migration.ledger.people[2].roles).toEqual(["supplier"]);
    expect(migration.ledger.people[2].identityType).toBeUndefined();
    expect(migration.ledger.entries).toEqual(original.entries);
    expect(migration.ledger.milestones).toEqual([]);
    expect(migration.ledger.paymentAllocations).toEqual([]);
    expect(migration.report.before).toEqual(migration.report.after);
    expect(
      migration.report.before.accounts.find((row) => row.account === "labour")
        ?.historicalCount,
    ).toBe(0);
    expect(
      migration.report.before.accounts.find(
        (row) => row.account === "materials",
      )?.historicalCount,
    ).toBe(1);
    expect(migration.report.before.project).toMatchObject({
      cost: 14000,
      paid: 3000,
      payable: 7000,
    });
    expect(migration.report.duplicatePartyCandidates).toEqual([
      ["p", "duplicate"],
    ]);
    expect(migration.report.ambiguousCashEntryIds).toEqual(["paid"]);
    expect(migrateArchitecture(migration.ledger).changed).toBe(false);
  });

  it("rejects corrupt money and unsupported future versions without mutating source", () => {
    const source = legacyArchitectureFixture();
    expect(() =>
      migrateArchitecture({ ...source, architectureVersion: 3 }),
    ).toThrow();
    const corrupt = structuredClone(source);
    corrupt.entries[0].lines[0].amount = 0.5;
    expect(() => migrateArchitecture(corrupt)).toThrow();
    expect(source.entries[0].lines[0].amount).toBe(10000);
  });

  it("blocks omission or mutation of established allocation history while allowing explicit role changes", () => {
    const ledger = migrateArchitecture(legacyArchitectureFixture()).ledger;
    ledger.paymentAllocations = [
      {
        id: "a",
        paymentId: "paid",
        billId: "bill",
        amount: 1000,
        createdAt: "2026-11-05T00:00:00.000Z",
      },
    ];
    expect(
      preservesArchitecture(ledger, { ...ledger, paymentAllocations: [] }),
    ).toBe(false);
    expect(
      preservesArchitecture(ledger, {
        ...ledger,
        paymentAllocations: [{ ...ledger.paymentAllocations[0], amount: 2000 }],
      }),
    ).toBe(false);
    expect(
      preservesArchitecture(ledger, {
        ...ledger,
        people: ledger.people.map((person) => ({ ...person, roles: [] })),
      }),
    ).toBe(true);
    const stripped = structuredClone(ledger);
    delete stripped.people[0].roles;
    expect(preservesArchitecture(ledger, stripped)).toBe(false);
    delete stripped.architectureVersion;
    expect(preservesArchitecture(ledger, stripped)).toBe(false);
  });
});

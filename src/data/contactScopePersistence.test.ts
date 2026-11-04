import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { LedgerSchema } from "../domain/model";
import {
  appendBalanceAdjustment,
  readBalanceAdjustmentScope,
} from "../domain/balanceAdjustments";
import { contactAccountSummary } from "../domain/contacts";
import { contactStatement } from "../features/people/statement";
import { LedgerDatabase } from "./database";
import { LedgerRepository } from "./repository";

const databases: LedgerDatabase[] = [];
function repository() {
  const database = new LedgerDatabase(`contact-scope-${crypto.randomUUID()}`);
  databases.push(database);
  return new LedgerRepository(database);
}
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

it("keeps a driver's scoped correction and the excluded bills through save, reopen and backup restore", async () => {
  const repo = repository();
  const original = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "driver", name: "রনি", kind: "driver" }],
    entries: [
      {
        id: "trip",
        kind: "expense",
        personId: "driver",
        account: "other",
        lines: [
          {
            id: "trip-line",
            workId: "door",
            costType: "transport",
            amount: 100000,
          },
        ],
      },
      {
        id: "trip-paid",
        kind: "payment",
        personId: "driver",
        account: "other",
        relatedEntryId: "trip",
        allocations: [{ workId: "door", amount: 40000 }],
        paymentParts: [{ amount: 40000 }],
      },
      {
        id: "unload",
        kind: "expense",
        personId: "driver",
        account: "other",
        lines: [
          {
            id: "unload-line",
            workId: "door",
            costType: "unload",
            amount: 200000,
          },
        ],
      },
      {
        id: "unload-paid",
        kind: "payment",
        personId: "driver",
        account: "other",
        relatedEntryId: "unload",
        allocations: [{ workId: "door", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
    ],
  });
  const scope = {
    target: "person",
    basis: "balance",
    personId: "driver",
    account: "other",
    workId: "door",
  } as const;
  expect(readBalanceAdjustmentScope(original, scope).value).toBe(60000);
  const adjusted = appendBalanceAdjustment(
    original,
    {
      ...scope,
      expectedBefore: 60000,
      after: 30000,
      reason: "গাড়িভাড়া মিলিয়েছি",
    },
    "2026-11-04T08:00:00.000Z",
  );
  await repo.ensure("real", original);
  await repo.save(adjusted);
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.slice(0, 4)).toEqual(original.entries);
  expect(readBalanceAdjustmentScope(saved, scope).value).toBe(30000);
  const summary = contactAccountSummary(
    saved,
    saved.people[0],
    "other",
    "door",
  );
  expect(summary).toMatchObject({
    reconciledCost: 100000,
    actualNetPaid: 40000,
    reconciledPayable: 30000,
  });
  expect(summary.entries.map((entry) => entry.id)).not.toContain("unload");
  expect(
    contactStatement(saved, saved.people[0], {
      account: "other",
      workId: "door",
    }).totals.reconciledPayable,
  ).toBe(30000);
  const restored = repository();
  await restored.ensure("real", LedgerSchema.parse({}));
  await restored.importBackup(await repo.exportBackup(), { replace: true });
  expect((await restored.read())!.ledger).toEqual(saved);
});

it("does not rewrite old adjustment amounts or history when a contact becomes a driver", async () => {
  const source = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "driver", name: "রনি", kind: "other" }],
    entries: [
      {
        id: "trip",
        kind: "expense",
        personId: "driver",
        account: "other",
        lines: [
          {
            id: "trip-line",
            workId: "door",
            costType: "transport",
            amount: 100000,
          },
        ],
      },
      {
        id: "unload",
        kind: "expense",
        personId: "driver",
        account: "other",
        lines: [
          {
            id: "unload-line",
            workId: "door",
            costType: "unload",
            amount: 200000,
          },
        ],
      },
    ],
  });
  const scope = {
    target: "person",
    basis: "balance",
    personId: "driver",
    account: "other",
    workId: "door",
  } as const;
  const corrected = appendBalanceAdjustment(
    source,
    {
      ...scope,
      expectedBefore: 300000,
      after: 280000,
      reason: "আগের পরিচয়ের হিসাব",
    },
    "2026-11-04T08:00:00.000Z",
  );
  const repo = repository();
  await repo.ensure("real", corrected);
  await repo.save({
    ...corrected,
    people: corrected.people.map((person) => ({
      ...person,
      kind: "driver" as const,
    })),
  });
  const changed = (await repo.read())!.ledger;
  expect(changed.entries).toEqual(corrected.entries);
  expect(readBalanceAdjustmentScope(changed, scope).value).toBe(80000);
  await repo.save(
    appendBalanceAdjustment(
      changed,
      {
        ...scope,
        expectedBefore: 80000,
        after: 70000,
        reason: "নতুন গাড়িভাড়ার হিসাব",
      },
      "2026-11-04T09:00:00.000Z",
    ),
  );
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(saved.entries.slice(0, corrected.entries.length)).toEqual(
    corrected.entries,
  );
  expect(readBalanceAdjustmentScope(saved, scope).value).toBe(70000);
});

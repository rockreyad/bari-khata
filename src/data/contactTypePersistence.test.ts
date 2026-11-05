import { migrateArchitecture } from "../domain/architectureMigration";
import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { LedgerSchema } from "../domain/model";
import { contactPresetFor } from "../domain/contactTypes";
import { summarize } from "../domain/ledger";
import { LedgerDatabase } from "./database";
import { LedgerRepository } from "./repository";
import { synchronizeWorkspace } from "./sync";

const databases: LedgerDatabase[] = [];
const fixture = () =>
  LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা খাতা" }],
    people: [
      {
        id: "person",
        name: "নমুনা ব্যক্তি",
        role: "নকশার কাজ",
        kind: "other",
        contactType: "professional",
      },
    ],
    entries: [
      {
        id: "bill",
        kind: "expense",
        personId: "person",
        account: "other",
        lines: [
          {
            id: "line",
            label: "নমুনা দর",
            workId: "work",
            costType: "other",
            amount: 150000,
          },
        ],
      },
      {
        id: "payment",
        kind: "payment",
        personId: "person",
        account: "other",
        allocations: [{ workId: "work", amount: 50000 }],
        paymentParts: [{ amount: 50000 }],
      },
    ],
  });
function repository() {
  const database = new LedgerDatabase(`contact-types-${crypto.randomUUID()}`);
  databases.push(database);
  return new LedgerRepository(database);
}
afterEach(async () => {
  for (const database of databases.splice(0)) await database.delete();
});

it("retains the explicit type after description edits, IndexedDB reopening and backup restoration", async () => {
  const repo = repository();
  const ledger = fixture();
  const totals = summarize(ledger);
  await repo.ensure("real", ledger);
  await repo.save((current) => ({
    ...current,
    people: current.people.map((person) => ({
      ...person,
      role: "অন্য নতুন পরিচয়",
    })),
  }));
  repo.database.close();
  await repo.database.open();
  const saved = (await repo.read())!.ledger;
  expect(contactPresetFor(saved.people[0]).id).toBe("professional");
  expect(saved.people[0].kind).toBe("other");
  expect(saved.entries).toEqual(ledger.entries);
  expect(summarize(saved)).toEqual(totals);
  const copy = await repo.exportBackup();
  const restored = repository();
  await restored.ensure("real", LedgerSchema.parse({}));
  await restored.importBackup(copy, { replace: true });
  expect((await restored.read())!.ledger).toEqual(
    migrateArchitecture(saved).ledger,
  );
  const corrupt = JSON.parse(copy);
  delete corrupt.integrity;
  corrupt.ledger.people[0].contactType = "unknown";
  await expect(
    restored.importBackup(JSON.stringify(corrupt), { replace: true }),
  ).rejects.toThrow();
  expect((await restored.read())!.ledger).toEqual(
    migrateArchitecture(saved).ledger,
  );
});

it("reads old backups without inventing a saved type and refuses to drop an existing selection", async () => {
  const repo = repository();
  const ledger = fixture();
  await repo.ensure("real", ledger);
  const oldCopy = JSON.parse(await repo.exportBackup());
  delete oldCopy.integrity;
  delete oldCopy.ledger.people[0].contactType;
  const empty = repository();
  await empty.ensure("real", LedgerSchema.parse({}));
  await empty.importBackup(JSON.stringify(oldCopy), { replace: true });
  expect(
    Object.hasOwn((await empty.read())!.ledger.people[0], "contactType"),
  ).toBe(false);
  const omitted = fixture();
  delete omitted.people[0].contactType;
  await expect(repo.save(omitted)).rejects.toThrow(
    "contact_type_would_be_lost",
  );
  omitted.people[0].contactType = undefined;
  await expect(repo.save(omitted)).rejects.toThrow(
    "contact_type_would_be_lost",
  );
  await expect(
    repo.importBackup(JSON.stringify(oldCopy), { replace: true }),
  ).rejects.toThrow("contact_type_would_be_lost");
  await expect(
    repo.mergeBackup(JSON.stringify(oldCopy), {
      expectedLedger: ledger,
      decisions: { "people:person": "backup" },
      confirmed: true,
      at: "2026-11-05T00:00:00.000Z",
    }),
  ).rejects.toThrow("contact_type_would_be_lost");
  expect((await repo.read())!.ledger).toEqual(ledger);
  const explicit = fixture();
  explicit.people[0].contactType = "custom";
  await repo.save(explicit);
  expect((await repo.read())!.ledger.people[0].contactType).toBe("custom");
  expect((await repo.read())!.ledger.entries).toEqual(ledger.entries);
});

it("keeps the selected type and records a conflict when an older cloud client strips it", async () => {
  const repo = repository();
  const ledger = fixture();
  await repo.ensure("real", ledger);
  const omitted = fixture();
  delete omitted.people[0].contactType;
  const result = await synchronizeWorkspace(
    {
      ownerId: "owner-one",
      load: async () => ({ revision: 1, document: omitted, updatedAt: null }),
      save: async () => {
        throw new Error("Unexpected cloud write");
      },
    },
    repo,
  );
  expect(result.status).toBe("conflict");
  expect((await repo.read())!.ledger).toEqual(ledger);
  expect(await repo.database.conflicts.get("real")).toBeTruthy();
});

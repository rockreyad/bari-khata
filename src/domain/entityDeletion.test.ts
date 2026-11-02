import { describe, expect, it } from "vitest";
import { LedgerSchema } from "./model";
import {
  setEntityRemoved,
  preservesRemovalHistory,
  type RemovableKind,
} from "./entityDeletion";
import { summarize } from "./ledger";

export function removalFixture() {
  return LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    contracts: [
      {
        id: "job",
        workId: "door",
        personId: "worker",
        total: 200000,
        title: "দরজা লাগানো",
      },
    ],
    entries: [
      {
        id: "paid",
        kind: "payment",
        personId: "worker",
        contractId: "job",
        account: "labour",
        allocations: [{ workId: "door", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
    ],
  });
}
describe.each([
  ["work", "works", "door"],
  ["person", "people", "worker"],
  ["contract", "contracts", "job"],
] as const)("reversible %s removal", (kind, key, id) => {
  it("keeps all transactions and money while recording removal and restoration", () => {
    const before = removalFixture();
    const removed = setEntityRemoved(
      before,
      kind,
      id,
      true,
      undefined,
      "2026-11-02T00:00:00Z",
    );
    expect(removed[key][0].archivedAt).toBe("2026-11-02T00:00:00Z");
    expect(removed.entries).toEqual(before.entries);
    expect(summarize(removed)).toEqual(summarize(before));
    expect(preservesRemovalHistory(before, removed)).toBe(true);
    const restored = setEntityRemoved(
      removed,
      kind,
      id,
      false,
      undefined,
      "2026-11-02T01:00:00Z",
    );
    expect(restored[key][0].archivedAt).toBeNull();
    expect(
      restored[key][0].removalHistory.map((event) => event.archived),
    ).toEqual([true, false]);
    expect(restored.entries).toEqual(before.entries);
    expect(preservesRemovalHistory(removed, restored)).toBe(true);
    expect(preservesRemovalHistory(removed, before)).toBe(false);
  });
  it("rejects wrong names, missing identities and stripped removal history", () => {
    const before = removalFixture();
    expect(() =>
      setEntityRemoved(before, kind as RemovableKind, id, true, "wrong"),
    ).toThrow("নাম বদলেছে");
    expect(() =>
      setEntityRemoved(before, kind as RemovableKind, "missing", true),
    ).toThrow("নামটি পাওয়া যায়নি");
    const removed = setEntityRemoved(before, kind, id, true);
    const stripped = LedgerSchema.parse({
      ...removed,
      [key]: removed[key].map((entity) => ({
        ...entity,
        archivedAt: null,
        removalHistory: [],
      })),
    });
    expect(preservesRemovalHistory(removed, stripped)).toBe(false);
    const invalid = {
      ...removed,
      [key]: removed[key].map((entity) => ({ ...entity, archivedAt: null })),
    };
    expect(LedgerSchema.safeParse(invalid).success).toBe(false);
  });
});

it("rejects repeated, reordered and rewritten archive events", () => {
  const removed = setEntityRemoved(
    removalFixture(),
    "work",
    "door",
    true,
    undefined,
    "2026-11-02T00:00:00Z",
  );
  const restored = setEntityRemoved(
    removed,
    "work",
    "door",
    false,
    undefined,
    "2026-11-02T01:00:00Z",
  );
  const rewrites = structuredClone(restored);
  rewrites.works[0].removalHistory[0].id = "rewrite";
  expect(preservesRemovalHistory(removed, rewrites)).toBe(false);
  expect(() =>
    setEntityRemoved(
      removed,
      "work",
      "door",
      false,
      undefined,
      "2026-11-01T00:00:00Z",
    ),
  ).toThrow();
  expect(
    setEntityRemoved(removed, "work", "door", true).works[0].removalHistory,
  ).toHaveLength(1);
});

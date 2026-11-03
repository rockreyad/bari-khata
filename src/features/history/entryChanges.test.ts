import { describe, expect, it } from "vitest";
import { EntryCoreSchema } from "../../domain/model";
import { entryDisplayChanges } from "./entryChanges";

const bill = () =>
  EntryCoreSchema.parse({
    id: "bill",
    kind: "expense",
    account: "labour",
    note: "মজুরির বিল",
    lines: [
      {
        id: "line",
        workId: "bathroom",
        label: "কাজের মজুরি",
        costType: "labour",
        amount: 6000000,
      },
    ],
  });
const payment = () =>
  EntryCoreSchema.parse({
    id: "paid",
    kind: "payment",
    account: "labour",
    paymentParts: [{ method: "cash", amount: 6000000 }],
    allocations: [{ workId: "bathroom", amount: 6000000 }],
  });

describe("minimal entry revision changes", () => {
  it("shows a single bill amount once without repeating its unchanged line, work or account", () => {
    const before = bill(),
      after = structuredClone(before);
    after.lines[0].amount = 1000000;
    expect(entryDisplayChanges(before, after)).toEqual([
      {
        key: "line:line:amount",
        field: "amount",
        before: 6000000,
        after: 1000000,
        context: undefined,
      },
    ]);
    expect(before.lines[0].amount).toBe(6000000);
  });

  it("shows only the changed line of a multi-line bill, without an additional total", () => {
    const before = bill();
    before.lines.push({
      ...before.lines[0],
      id: "second",
      label: "অন্য কাজ",
      amount: 200000,
    });
    const after = structuredClone(before);
    after.lines[0].amount = 1000000;
    const changes = entryDisplayChanges(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      field: "amount",
      before: 6000000,
      after: 1000000,
      context: { line: { id: "line" } },
    });
    expect(JSON.stringify(changes)).not.toContain("অন্য কাজ");
  });

  it("shows a payment amount once when its allocation mirrors the same correction", () => {
    const before = payment(),
      after = structuredClone(before);
    after.paymentParts[0].amount = 1000000;
    after.allocations[0].amount = 1000000;
    expect(entryDisplayChanges(before, after)).toEqual([
      {
        key: "payment:amount",
        field: "amount",
        before: 6000000,
        after: 1000000,
      },
    ]);
  });

  it("does not repeat proportionally scaled allocations but keeps an actual redistribution", () => {
    const before = payment();
    before.paymentParts[0].amount = 300000;
    before.allocations = [
      { workId: "bathroom", amount: 100000 },
      { workId: "electric", amount: 200000 },
    ];
    const scaled = structuredClone(before);
    scaled.paymentParts[0].amount = 600000;
    scaled.allocations = [
      { workId: "bathroom", amount: 200000 },
      { workId: "electric", amount: 400000 },
    ];
    expect(
      entryDisplayChanges(before, scaled).map((change) => change.key),
    ).toEqual(["payment:amount"]);
    const redistributed = structuredClone(before);
    redistributed.allocations.reverse();
    redistributed.allocations[0].amount = 100000;
    redistributed.allocations[1].amount = 200000;
    expect(
      entryDisplayChanges(before, redistributed).map(
        (change) => change.context?.workId,
      ),
    ).toEqual(["bathroom", "electric"]);
  });

  it("shows a changed payment method separately and ignores reordered equivalent parts", () => {
    const before = payment(),
      after = structuredClone(before);
    after.paymentParts[0].method = "bkash";
    expect(entryDisplayChanges(before, after)).toEqual([
      {
        key: "payment:method",
        field: "method",
        before: "cash",
        after: "bkash",
      },
    ]);
    before.paymentParts = [
      { method: "cash", amount: 1000000 },
      { method: "bank", amount: 5000000 },
    ];
    after.paymentParts = [...before.paymentParts].reverse();
    expect(entryDisplayChanges(before, after)).toEqual([]);
  });

  it("distinguishes added and removed lines, and ignores line IDs and order alone", () => {
    const before = bill(),
      after = structuredClone(before);
    after.lines = [{ ...after.lines[0], id: "new", label: "নতুন কাজ" }];
    expect(
      entryDisplayChanges(before, after).map((change) => [
        change.operation,
        change.field,
      ]),
    ).toEqual([
      ["added", "lines"],
      ["removed", "lines"],
    ]);
    after.lines = [{ ...before.lines[0], id: "regenerated" }];
    expect(entryDisplayChanges(before, after)).toEqual([]);
  });

  it("reserves stable IDs before matching new rows with identical descriptions", () => {
    const before = bill();
    before.lines = [
      { ...before.lines[0], id: "A", amount: 10000 },
      { ...before.lines[0], id: "B", amount: 20000 },
    ];
    const after = structuredClone(before);
    after.lines = [
      { ...before.lines[0], id: "NEW", amount: 10000 },
      { ...before.lines[0], amount: 30000 },
    ];
    expect(entryDisplayChanges(before, after)).toMatchObject([
      { key: "line:NEW:added", operation: "added", after: { amount: 10000 } },
      { key: "line:A:amount", before: 10000, after: 30000 },
      {
        key: "line:B:removed",
        operation: "removed",
        before: { amount: 20000 },
      },
    ]);
  });

  it("matches exact equivalent rows first when every line ID was regenerated", () => {
    const before = bill();
    before.lines = [
      { ...before.lines[0], id: "A", amount: 10000 },
      { ...before.lines[0], id: "B", amount: 20000 },
    ];
    const after = structuredClone(before);
    after.lines = [
      { ...before.lines[0], id: "new-B", amount: 30000 },
      { ...before.lines[0], id: "new-A" },
    ];
    expect(entryDisplayChanges(before, after)).toMatchObject([
      { key: "line:new-B:amount", before: 20000, after: 30000 },
    ]);
  });

  it.each(["হিসাব মেলানোর কারণ", "Reason for the correction"])(
    "keeps the appended financial reason without repeating the unchanged note (%s)",
    (prefix) => {
      const before = bill(),
        after = structuredClone(before);
      after.note = `${before.note}\n${prefix}: আগের অঙ্কটি ভুল ছিল`;
      const changes = entryDisplayChanges(before, after);
      expect(changes).toEqual([
        {
          key: "correctionReason",
          field: "correctionReason",
          before: null,
          after: "আগের অঙ্কটি ভুল ছিল",
        },
      ]);
    },
  );

  it("shows quantity and unit as one correction and receipts as simple additions/removals", () => {
    const before = bill(),
      after = structuredClone(before);
    before.lines[0].quantity = "2";
    before.lines[0].unit = "দিন";
    after.lines[0].quantity = "3";
    after.lines[0].unit = "দিন";
    after.receipts.push({
      id: "file",
      name: "ভাউচার.png",
      mime: "image/png",
      size: 4,
    });
    expect(entryDisplayChanges(before, after)).toMatchObject([
      { field: "quantity", before: "2 দিন", after: "3 দিন" },
      { field: "receipts", operation: "added", format: "receipt" },
    ]);
  });
});

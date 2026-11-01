import { describe, expect, it } from "vitest";
import { createDemoLedger } from "../domain/demo";
import { EntrySchema } from "../domain/model";
import { buildCsv } from "./display";

const t = (value: string) => value;
function sharedEntries() {
  const expense = EntrySchema.parse({
    id: "shared-transport",
    kind: "expense",
    date: "2026-11-01",
    personId: "driver",
    account: "materials",
    lines: [
      {
        id: "tiles-share",
        workId: "tiles",
        costType: "transport",
        label: "ভাড়া",
        amount: 400000,
      },
      {
        id: "electric-share",
        workId: "electric",
        costType: "transport",
        label: "ভাড়া",
        amount: 200000,
      },
    ],
  });
  const payment = EntrySchema.parse({
    id: "shared-payment",
    kind: "payment",
    date: "2026-11-01",
    personId: "driver",
    account: "materials",
    allocations: [
      { workId: "tiles", amount: 400000 },
      { workId: "electric", amount: 200000 },
    ],
    paymentParts: [{ method: "cash", amount: 600000 }],
  });
  return [expense, payment];
}
describe("work-filtered reports", () => {
  it("exports only the selected work share of both a bill and payment", () => {
    const csv = buildCsv(createDemoLedger(), sharedEntries(), t, "tiles");
    const rows = csv.split("\r\n").slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toContain('"4000"');
      expect(row).not.toContain('"6000"');
      expect(row).toContain('"টাইলসের কাজ"');
      expect(row).not.toContain("বিদ্যুতের কাজ");
    }
  });
  it("keeps the original amount when exporting all works", () => {
    const rows = buildCsv(createDemoLedger(), sharedEntries(), t)
      .split("\r\n")
      .slice(1);
    for (const row of rows) {
      expect(row).toContain('"6000"');
      expect(row).toContain("টাইলসের কাজ / বিদ্যুতের কাজ");
    }
  });
});

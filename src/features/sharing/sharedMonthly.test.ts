import { describe, expect, it, vi } from "vitest";
import { SharedStatementSchema, type SharedStatement } from "./shareModel";
import { readSharedMonthly, SHARED_MONTHLY_MAX_ROWS } from "./sharedMonthly";

type Row = SharedStatement["rows"][number];
const token = "a".repeat(64);
function cash(
  key: string,
  paid: number,
  date: string | null = "2026-11-06",
  kind: "payment" | "refund" = paid < 0 ? "refund" : "payment",
): Row {
  return {
    key,
    date,
    kind,
    historical: false,
    charge: 0,
    paid,
    description: "নমুনা টাকা",
    works: "নমুনা খাতা",
  };
}
function source(rows: Row[]) {
  const active = rows.filter((row) => !row.historical);
  const received = active
    .filter((row) => row.kind === "payment")
    .reduce((sum, row) => sum + row.paid, 0);
  const refunded = -active
    .filter((row) => row.kind === "refund")
    .reduce((sum, row) => sum + row.paid, 0);
  return SharedStatementSchema.parse({
    person: { name: "নমুনা মিস্ত্রি", role: "মিস্ত্রি", kind: "worker" },
    projectName: "নমুনা বাড়ি",
    account: "labour",
    workName: "নমুনা খাতা",
    updatedAt: "2026-11-06T12:00:00Z",
    revision: 3,
    total: rows.length,
    nextOffset: rows.length > 20 ? 20 : null,
    counts: {
      payment: rows.filter((row) => row.kind === "payment").length,
      refund: rows.filter((row) => row.kind === "refund").length,
    },
    totals: {
      cost: 0,
      paid: received - refunded,
      payable: 0,
      advance: received - refunded,
      historicalCost: 0,
      actualPaid: received,
      actualRefunds: refunded,
      actualNetPaid: received - refunded,
    },
    rows: rows.slice(0, 20),
  });
}
function reader(statement: SharedStatement, rows: Row[]) {
  return vi.fn(
    async (
      _token: string,
      offset: number,
      _revision: number,
      kind: "payment" | "refund",
    ) => {
      const matches = rows.filter((row) => row.kind === kind);
      return {
        ...statement,
        total: matches.length,
        rows: matches.slice(offset, offset + 20),
        nextOffset: offset + 20 < matches.length ? offset + 20 : null,
      };
    },
  );
}

describe("complete shared cash months", () => {
  it("reads raw cash across pages and years, separates undated money and returns, and excludes historical and noncash corrections", async () => {
    const rows = [
      ...Array.from({ length: 22 }, (_, i) =>
        cash(`sample-${i}`, 1000, i < 20 ? "2026-02-06" : "2025-12-06"),
      ),
      cash("sample-refund", -2500, "2026-02-07"),
      cash("sample-old-refund", -2000, "2025-12-07"),
      cash("sample-undated", 500, null),
      { ...cash("sample-history", 9000, "2024-01-01"), historical: true },
    ];
    const statement = source(rows);
    statement.totals.paidCorrection = 5000;
    statement.totals.reconciledNetPaid = 23000;
    const read = reader(statement, rows);
    const result = await readSharedMonthly(token, statement, read);
    expect(result).toEqual({
      revision: 3,
      months: [
        { month: "2025-12", received: 2000, refunded: 2000, net: 0 },
        { month: "2026-02", received: 20000, refunded: 2500, net: 17500 },
      ],
      undated: { received: 500, refunded: 0, net: 500 },
      totals: { received: 22500, refunded: 4500, net: 18000 },
    });
    expect(read.mock.calls.map((call) => call.slice(1, 4))).toEqual([
      [0, 3, "payment"],
      [0, 3, "refund"],
      [20, 3, "payment"],
    ]);
    expect(statement.totals.paidCorrection).toBe(5000);
  });

  it("returns an empty complete dataset without cash reads when nothing was paid", async () => {
    const read = vi.fn();
    expect(await readSharedMonthly(token, source([]), read)).toEqual({
      revision: 3,
      months: [],
      undated: { received: 0, refunded: 0, net: 0 },
      totals: { received: 0, refunded: 0, net: 0 },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects a changed revision instead of combining snapshots", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => cash(`sample-${i}`, 100));
    const statement = source(rows);
    const read = reader(statement, rows);
    const implementation = read.getMockImplementation()!;
    read.mockImplementation(async (...args) => ({
      ...(await implementation(...args)),
      revision: args[1] === 20 ? 4 : 3,
    }));
    await expect(readSharedMonthly(token, statement, read)).rejects.toThrow(
      "share_changed",
    );
  });

  it("rejects scope or financial context changes even if the revision is unchanged", async () => {
    const rows = [cash("sample", 100)];
    const statement = source(rows);
    const read = reader({ ...statement, workName: "অন্য নমুনা খাতা" }, rows);
    await expect(readSharedMonthly(token, statement, read)).rejects.toThrow(
      "share_changed",
    );
  });

  it("rejects duplicate keys across pages", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => cash(`sample-${i}`, 100));
    const statement = source(rows);
    rows[20] = { ...rows[20], key: rows[0].key };
    await expect(
      readSharedMonthly(token, statement, reader(statement, rows)),
    ).rejects.toThrow("share_invalid_page");
  });

  it("rejects partial filtered histories instead of publishing partial totals", async () => {
    const rows = [cash("sample-1", 100), cash("sample-2", 100)];
    const statement = source(rows);
    await expect(
      readSharedMonthly(token, statement, reader(statement, rows.slice(0, 1))),
    ).rejects.toThrow("share_invalid_page");
  });

  it("rejects totals that do not reconcile with actual cash", async () => {
    const rows = [cash("sample", 100)];
    const statement = source(rows);
    statement.totals.actualNetPaid = 50;
    await expect(
      readSharedMonthly(token, statement, reader(statement, rows)),
    ).rejects.toThrow("share_invalid_page");
  });

  it.each([{ date: "2026-02-30" }, { paid: -100 }, { charge: 100 }])(
    "rejects invalid cash data: %o",
    async (invalid) => {
      const rows = [cash("sample", 100)];
      const statement = source(rows);
      rows[0] = { ...rows[0], ...invalid };
      await expect(
        readSharedMonthly(token, statement, reader(statement, rows)),
      ).rejects.toThrow();
    },
  );

  it("rejects unsafe aggregate integer amounts", async () => {
    const rows = [
      cash("sample-1", Number.MAX_SAFE_INTEGER),
      cash("sample-2", 1),
    ];
    const statement = source([rows[0]]);
    statement.counts.payment = 2;
    await expect(
      readSharedMonthly(token, statement, reader(statement, rows)),
    ).rejects.toThrow("share_invalid_page");
  });

  it("stops oversized histories before requesting them", async () => {
    const statement = source([]);
    statement.counts.payment = SHARED_MONTHLY_MAX_ROWS + 1;
    const read = vi.fn();
    await expect(readSharedMonthly(token, statement, read)).rejects.toThrow(
      "share_monthly_too_large",
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects oversized text without returning partial amounts", async () => {
    const rows = Array.from({ length: 17 }, (_, i) => ({
      ...cash(`sample-${i}`, 100),
      description: "x".repeat(310000),
      works: "y".repeat(210000),
    }));
    const statement = source(rows);
    await expect(
      readSharedMonthly(token, statement, reader(statement, rows)),
    ).rejects.toThrow("share_monthly_too_large");
  });

  it("does not follow another page after cancellation", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => cash(`sample-${i}`, 100));
    const statement = source(rows);
    const controller = new AbortController();
    const read = reader(statement, rows);
    const implementation = read.getMockImplementation()!;
    read.mockImplementation(async (...args) => {
      const result = await implementation(...args);
      controller.abort();
      return result;
    });
    await expect(
      readSharedMonthly(token, statement, read, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(read).toHaveBeenCalledOnce();
  });

  it("reports a revoked link without exposing earlier pages", async () => {
    const rows = [cash("sample", 100)];
    await expect(
      readSharedMonthly(token, source(rows), async () => null),
    ).rejects.toThrow("share_unavailable");
  });

  it.each([
    ["offline", "share_unavailable", "share_unavailable"],
    ["offline", "share_changed", "share_changed"],
    ["share_changed", "share_unavailable", "share_unavailable"],
    ["share_unavailable", "share_changed", "share_unavailable"],
    ["share_invalid_page", "offline", "share_invalid_page"],
  ])(
    "prioritizes share invalidation for mixed failures %s / %s",
    async (paymentError, refundError, expected) => {
      const rows = [cash("sample-payment", 100), cash("sample-refund", -50)];
      const read = vi.fn(async (_token, _offset, _revision, kind) => {
        const error = kind === "payment" ? paymentError : refundError;
        if (error === "share_unavailable") return null;
        throw new Error(error);
      });
      await expect(
        readSharedMonthly(token, source(rows), read),
      ).rejects.toThrow(expected);
      expect(read).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects a cancelled empty history without returning empty success", async () => {
    const controller = new AbortController();
    controller.abort();
    const read = vi.fn();
    await expect(
      readSharedMonthly(token, source([]), read, { signal: controller.signal }),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});

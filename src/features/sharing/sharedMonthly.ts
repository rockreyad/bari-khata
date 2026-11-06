import { z } from "zod";
import {
  SharedStatementSchema,
  validateSharedPage,
  type SharedStatement,
} from "./shareModel";

export const SHARED_MONTHLY_MAX_ROWS = 2000;
export const SHARED_MONTHLY_MAX_CHARACTERS = 8 * 1024 * 1024;
type CashKind = "payment" | "refund";
export type SharedCashAmounts = {
  received: number;
  refunded: number;
  net: number;
};
export type SharedMonthlyData = {
  revision: number;
  months: Array<SharedCashAmounts & { month: string }>;
  undated: SharedCashAmounts;
  totals: SharedCashAmounts;
};
export type SharedMonthlyReader = (
  token: string,
  offset: number,
  revision: number,
  kind: CashKind,
  options: { signal?: AbortSignal },
) => Promise<SharedStatement | null>;

const cashRow = z
  .object({
    kind: z.enum(["payment", "refund"]),
    paid: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    charge: z.literal(0),
    date: z.iso.date().nullable(),
  })
  .refine((row) => (row.kind === "payment" ? row.paid >= 0 : row.paid <= 0));

export function sharedMonthlyScope(statement: SharedStatement) {
  return JSON.stringify({
    revision: statement.revision,
    projectName: statement.projectName,
    person: statement.person,
    account: statement.account,
    workName: statement.workName,
    updatedAt: statement.updatedAt,
    totals: statement.totals,
    counts: statement.counts,
  });
}

const emptyAmounts = (): SharedCashAmounts => ({
  received: 0,
  refunded: 0,
  net: 0,
});
function add(amounts: SharedCashAmounts, kind: CashKind, paid: number) {
  const next = {
    received: BigInt(amounts.received) + BigInt(kind === "payment" ? paid : 0),
    refunded: BigInt(amounts.refunded) - BigInt(kind === "refund" ? paid : 0),
    net: BigInt(amounts.net) + BigInt(paid),
  };
  for (const key of ["received", "refunded", "net"] as const) {
    if (
      next[key] > BigInt(Number.MAX_SAFE_INTEGER) ||
      next[key] < BigInt(-Number.MAX_SAFE_INTEGER)
    )
      throw new Error("share_invalid_page");
    amounts[key] = Number(next[key]);
  }
}

export async function readSharedMonthly(
  token: string,
  statement: SharedStatement,
  read: SharedMonthlyReader,
  options: { signal?: AbortSignal } = {},
): Promise<SharedMonthlyData> {
  const source = SharedStatementSchema.parse(statement);
  const expected = sharedMonthlyScope(source);
  if (source.counts.payment + source.counts.refund > SHARED_MONTHLY_MAX_ROWS)
    throw new Error("share_monthly_too_large");
  const months = new Map<string, SharedCashAmounts>();
  const undated = emptyAmounts();
  const totals = emptyAmounts();
  const keys = new Set<string>();
  let characters = 0;

  async function page(kind: CashKind, offset: number) {
    options.signal?.throwIfAborted();
    const response = await read(token, offset, source.revision, kind, options);
    options.signal?.throwIfAborted();
    if (!response) throw new Error("share_unavailable");
    const current = validateSharedPage(
      SharedStatementSchema.parse(response),
      offset,
      source.revision,
      kind,
    );
    if (sharedMonthlyScope(current) !== expected)
      throw new Error("share_changed");
    if (current.total !== source.counts[kind])
      throw new Error("share_invalid_page");
    return current;
  }
  function append(current: SharedStatement) {
    for (const row of current.rows) {
      cashRow.parse(row);
      if (keys.has(row.key)) throw new Error("share_invalid_page");
      keys.add(row.key);
      characters += row.key.length + row.description.length + row.works.length;
      if (characters > SHARED_MONTHLY_MAX_CHARACTERS)
        throw new Error("share_monthly_too_large");
      if (row.historical) continue;
      const kind = row.kind as CashKind;
      const month = row.date?.slice(0, 7);
      const amounts = month ? (months.get(month) ?? emptyAmounts()) : undated;
      add(amounts, kind, row.paid);
      add(totals, kind, row.paid);
      if (month) months.set(month, amounts);
    }
  }
  const kinds = (["payment", "refund"] as const).filter(
    (kind) => source.counts[kind] > 0,
  );
  const firstPages = await Promise.allSettled(
    kinds.map((kind) => page(kind, 0)),
  );
  const failures = firstPages.filter((result) => result.status === "rejected");
  const failure =
    failures.find(
      ({ reason }) =>
        reason instanceof Error && reason.message === "share_unavailable",
    ) ??
    failures.find(
      ({ reason }) =>
        reason instanceof Error && reason.message === "share_changed",
    ) ??
    failures[0];
  if (failure) throw failure.reason;
  for (const [index, first] of firstPages.entries()) {
    if (first.status !== "fulfilled") continue;
    let current = first.value;
    append(current);
    while (current.nextOffset !== null) {
      current = await page(kinds[index], current.nextOffset);
      append(current);
    }
  }
  options.signal?.throwIfAborted();
  if (
    keys.size !== source.counts.payment + source.counts.refund ||
    totals.net !== (source.totals.actualNetPaid ?? source.totals.paid) ||
    (source.totals.actualPaid !== undefined &&
      totals.received !== source.totals.actualPaid) ||
    (source.totals.actualRefunds !== undefined &&
      totals.refunded !== source.totals.actualRefunds)
  )
    throw new Error("share_invalid_page");
  return {
    revision: source.revision,
    months: [...months]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amounts]) => ({ month, ...amounts })),
    undated,
    totals,
  };
}

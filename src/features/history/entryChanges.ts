import type { EntryLine, PaymentPart } from "../../domain/model";
import type { AuditField, EntrySnapshot } from "./audit";

export type EntryChangeField =
  | AuditField
  | "amount"
  | "workId"
  | "itemId"
  | "materialGroupId"
  | "costType"
  | "label"
  | "quantity"
  | "usage"
  | "method"
  | "receiptName"
  | "correctionReason"
  | `source.${"file" | "sheet" | "cell" | "note" | "ledger"}`
  | `provenance.${"actorName" | "origin" | "reason"}`;
export type EntryDisplayChange = {
  key: string;
  field: EntryChangeField;
  before: unknown;
  after: unknown;
  context?: {
    line?: EntryLine;
    workId?: string;
    method?: PaymentPart["method"];
  };
  operation?: "added" | "removed";
  format?: "line" | "allocation" | "payment" | "receipt";
};
const same = (before: unknown, after: unknown) =>
  JSON.stringify(before ?? "") === JSON.stringify(after ?? "");

function groupedAmounts<T>(
  rows: readonly T[],
  key: (row: T) => string,
  amount: (row: T) => number,
) {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const id = key(row);
    groups.set(id, (groups.get(id) ?? 0) + amount(row));
  }
  return groups;
}

export function entryDisplayChanges(
  before: EntrySnapshot,
  after: EntrySnapshot,
): EntryDisplayChange[] {
  const changes: EntryDisplayChange[] = [];
  const add = (
    key: string,
    field: EntryChangeField,
    previous: unknown,
    next: unknown,
    extra: Partial<EntryDisplayChange> = {},
  ) => {
    if (!same(previous, next))
      changes.push({ key, field, before: previous, after: next, ...extra });
  };
  const scalarFields: AuditField[] = [
    "kind",
    "date",
    "personId",
    "account",
    "paymentPurposeId",
    "contractId",
    "relatedEntryId",
    "voided",
    "balanceImpact",
    "reviewStatus",
    "reviewReason",
    "createdAt",
  ];
  for (const field of scalarFields)
    add(field, field, before[field], after[field]);
  const appendedNote =
    before.note && after.note.startsWith(`${before.note}\n`)
      ? after.note.slice(before.note.length + 1)
      : !before.note
        ? after.note
        : "";
  const correction = appendedNote.match(
    /^(?:হিসাব মেলানোর কারণ|Reason for the correction):\s*([\s\S]+)$/,
  );
  if (correction)
    add("correctionReason", "correctionReason", null, correction[1]);
  else add("note", "note", before.note, after.note);

  const unmatched = new Set(before.lines);
  const matched = new Map<EntryLine, EntryLine>();
  for (const line of after.lines) {
    const previous = before.lines.find((row) => row.id === line.id);
    if (previous) {
      matched.set(line, previous);
      unmatched.delete(previous);
    }
  }
  // A mixed edit keeps stable IDs; unmatched rows are actual additions/removals.
  if (matched.size === 0) {
    for (const line of after.lines) {
      const previous = [...unmatched].find((row) =>
        same({ ...row, id: "" }, { ...line, id: "" }),
      );
      if (previous) {
        matched.set(line, previous);
        unmatched.delete(previous);
      }
    }
    for (const line of after.lines.filter((row) => !matched.has(row))) {
      const candidates = [...unmatched].filter((row) =>
        same({ ...row, id: "", amount: 0 }, { ...line, id: "", amount: 0 }),
      );
      if (candidates.length === 1) {
        matched.set(line, candidates[0]);
        unmatched.delete(candidates[0]);
      }
    }
  }
  const multipleLines = Math.max(before.lines.length, after.lines.length) > 1;
  for (const line of after.lines) {
    const previous = matched.get(line);
    if (!previous) {
      add(`line:${line.id}:added`, "lines", null, line, {
        operation: "added",
        format: "line",
        context: multipleLines ? { workId: line.workId } : undefined,
      });
      continue;
    }
    const context = multipleLines ? { line } : undefined;
    for (const field of [
      "label",
      "itemId",
      "materialGroupId",
      "workId",
      "costType",
      "amount",
      "usage",
    ] as const)
      add(`line:${line.id}:${field}`, field, previous[field], line[field], {
        context: field === "label" ? undefined : context,
      });
    add(
      `line:${line.id}:quantity`,
      "quantity",
      `${previous.quantity} ${previous.unit}`.trim(),
      `${line.quantity} ${line.unit}`.trim(),
      { context },
    );
  }
  for (const line of unmatched)
    add(`line:${line.id}:removed`, "lines", line, null, {
      operation: "removed",
      format: "line",
      context: multipleLines ? { workId: line.workId } : undefined,
    });

  const oldMethods = groupedAmounts(
    before.paymentParts,
    (part) => part.method,
    (part) => part.amount,
  );
  const newMethods = groupedAmounts(
    after.paymentParts,
    (part) => part.method,
    (part) => part.amount,
  );
  if (oldMethods.size === 1 && newMethods.size === 1) {
    const [oldMethod, oldAmount] = [...oldMethods][0];
    const [newMethod, newAmount] = [...newMethods][0];
    add("payment:method", "method", oldMethod, newMethod);
    add("payment:amount", "amount", oldAmount, newAmount);
  } else {
    for (const method of new Set([
      ...oldMethods.keys(),
      ...newMethods.keys(),
    ])) {
      const previous = oldMethods.get(method),
        next = newMethods.get(method);
      if (previous === undefined || next === undefined)
        add(
          `payment:${method}`,
          "paymentParts",
          previous === undefined ? null : { method, amount: previous },
          next === undefined ? null : { method, amount: next },
          {
            operation: previous === undefined ? "added" : "removed",
            format: "payment",
          },
        );
      else
        add(`payment:${method}:amount`, "amount", previous, next, {
          context: { method: method as PaymentPart["method"] },
        });
    }
  }

  const oldWorks = groupedAmounts(
    before.allocations,
    (part) => part.workId,
    (part) => part.amount,
  );
  const newWorks = groupedAmounts(
    after.allocations,
    (part) => part.workId,
    (part) => part.amount,
  );
  const oldTotal = [...oldWorks.values()].reduce(
    (sum, amount) => sum + amount,
    0,
  );
  const newTotal = [...newWorks.values()].reduce(
    (sum, amount) => sum + amount,
    0,
  );
  if (oldWorks.size === 1 && newWorks.size === 1) {
    add(
      "allocation:work",
      "workId",
      [...oldWorks.keys()][0],
      [...newWorks.keys()][0],
    );
  } else {
    const sameShares =
      oldTotal > 0 &&
      newTotal > 0 &&
      oldWorks.size === newWorks.size &&
      [...oldWorks].every(
        ([id, amount]) =>
          newWorks.has(id) &&
          BigInt(amount) * BigInt(newTotal) ===
            BigInt(newWorks.get(id)!) * BigInt(oldTotal),
      );
    if (!sameShares)
      for (const workId of new Set([...oldWorks.keys(), ...newWorks.keys()])) {
        const previous = oldWorks.get(workId),
          next = newWorks.get(workId);
        if (previous === undefined || next === undefined)
          add(
            `allocation:${workId}`,
            "allocations",
            previous === undefined ? null : { workId, amount: previous },
            next === undefined ? null : { workId, amount: next },
            {
              operation: previous === undefined ? "added" : "removed",
              format: "allocation",
            },
          );
        else
          add(`allocation:${workId}:amount`, "amount", previous, next, {
            context: { workId },
          });
      }
  }

  const oldFiles = new Map(before.receipts.map((file) => [file.id, file]));
  const newFiles = new Map(after.receipts.map((file) => [file.id, file]));
  for (const id of new Set([...oldFiles.keys(), ...newFiles.keys()])) {
    const previous = oldFiles.get(id),
      next = newFiles.get(id);
    if (!previous || !next)
      add(`receipt:${id}`, "receipts", previous ?? null, next ?? null, {
        operation: previous ? "removed" : "added",
        format: "receipt",
      });
    else add(`receipt:${id}:name`, "receiptName", previous.name, next.name);
  }
  for (const field of ["file", "sheet", "cell", "note", "ledger"] as const)
    add(
      `source:${field}`,
      `source.${field}`,
      before.source?.[field],
      after.source?.[field],
    );
  for (const field of ["actorName", "origin", "reason"] as const)
    add(
      `provenance:${field}`,
      `provenance.${field}`,
      before.provenance?.[field],
      after.provenance?.[field],
    );
  return changes;
}

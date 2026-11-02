import { describe, expect, it } from "vitest";
import {
  ContractSchema,
  ContractSnapshotSchema,
  LedgerSchema,
  type ContractSnapshot,
  type Ledger,
} from "./model";
import {
  contractChanges,
  preservesContractHistory,
  saveContractChange,
} from "./contracts";
import { contractSummary, summarize } from "./ledger";
import {
  legacyJobStatusLedger,
  withoutJobStatus,
} from "./testing/legacyJobStatus";

function change(
  ledger: Ledger,
  status: "planned" | "ongoing" | "done",
  reason = "কাজের অবস্থা লিখেছি",
) {
  return saveContractChange(
    ledger,
    ContractSchema.parse({ ...ledger.contracts[0], status }),
    reason,
    "2026-11-02T00:00:00Z",
  );
}

describe("independent job progress", () => {
  it("normalizes old missing status to unknown without changing financial values or earlier records", () => {
    const raw = legacyJobStatusLedger();
    const before = structuredClone(raw);
    const ledger = LedgerSchema.parse(raw);
    expect(ledger.contracts[0].status).toBeNull();
    expect(ledger.contracts[0].activity[0].before?.status).toBeNull();
    expect(ledger.contracts[0].activity[0].after.status).toBeNull();
    expect(withoutJobStatus(ledger)).toEqual(raw);
    expect(raw).toEqual(before);
    expect(preservesContractHistory(raw as Ledger, ledger)).toBe(true);
    expect(preservesContractHistory(ledger, raw as Ledger)).toBe(true);
    const snapshot = ContractSnapshotSchema.parse(raw.contracts[0]);
    expect(
      contractChanges(raw.contracts[0] as ContractSnapshot, snapshot),
    ).toEqual([]);
  });
  it("never marks a fully paid job as complete and permits completion with outstanding agreed money", () => {
    const ledger = LedgerSchema.parse(legacyJobStatusLedger());
    const full = structuredClone(ledger);
    full.entries[1].allocations[0].amount = 350000;
    full.entries[1].paymentParts[0].amount = 350000;
    const paid = LedgerSchema.parse(full);
    expect(contractSummary(paid, "job").remaining).toBe(0);
    expect(paid.contracts[0].status).toBeNull();
    const done = change(ledger, "done", "কাজ শেষ হয়েছে");
    expect(done.contracts[0].status).toBe("done");
    expect(contractSummary(done, "job").remaining).toBe(150000);
    expect(done.entries).toEqual(ledger.entries);
    expect(summarize(done)).toMatchObject({ cost: 100000, netPaid: 150000 });
    expect(change(paid, "planned").contracts[0].status).toBe("planned");
  });
  it("records a status-only change with its true previous status, reason and unchanged terms", () => {
    const raw = legacyJobStatusLedger();
    const ledger = LedgerSchema.parse(raw);
    expect(() => change(ledger, "ongoing", "")).toThrow("কেন বদলালেন");
    const next = change(ledger, "ongoing");
    const event = next.contracts[0].activity.at(-1)!;
    expect(contractChanges(event.before, event.after)).toEqual(["status"]);
    expect(event).toMatchObject({
      before: { status: null, total: 300000 },
      after: { status: "ongoing", total: 300000 },
      reason: "কাজের অবস্থা লিখেছি",
    });
    expect(preservesContractHistory(raw as Ledger, next)).toBe(true);
    expect(next.contracts[0].history).toEqual(ledger.contracts[0].history);
    expect(next.contracts[0].activity.slice(0, -1)).toEqual(
      ledger.contracts[0].activity,
    );
    expect(next.entries).toEqual(ledger.entries);
    const noAudit = {
      ...ledger,
      contracts: [{ ...ledger.contracts[0], status: "done" }],
    };
    expect(LedgerSchema.safeParse(noAudit).success).toBe(false);
  });
  it.each(["finished", "", 1, false])(
    "rejects invalid job status %s",
    (status) => {
      const ledger = LedgerSchema.parse(legacyJobStatusLedger());
      expect(
        ContractSchema.safeParse({ ...ledger.contracts[0], status }).success,
      ).toBe(false);
    },
  );
  it("does not equate rewritten financial or actual status history with a missing/null default", () => {
    const raw = legacyJobStatusLedger();
    const ledger = LedgerSchema.parse(raw);
    const financial = structuredClone(ledger);
    financial.contracts[0].activity[0].before!.total = 1;
    expect(preservesContractHistory(raw as Ledger, financial)).toBe(false);
    const status = structuredClone(ledger);
    status.contracts[0].activity[0].after.status = "done";
    expect(preservesContractHistory(raw as Ledger, status)).toBe(false);
    const legacy = LedgerSchema.parse({
      ...ledger,
      contracts: [{ ...ledger.contracts[0], activity: [] }],
    });
    const changed = change(legacy, "done");
    changed.contracts[0].activity[0].before!.status = "planned";
    expect(LedgerSchema.safeParse(changed).success).toBe(true);
    expect(preservesContractHistory(legacy, changed)).toBe(false);
  });
});

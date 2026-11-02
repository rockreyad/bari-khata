import {
  ContractSchema,
  EntrySchema,
  LedgerSchema,
  type Contract,
  type ContractActivity,
  type ContractSnapshot,
  type Ledger,
} from "../model";
import { saveContractChange } from "../contracts";

type LegacySnapshot = Omit<ContractSnapshot, "status"> & {
  status?: ContractSnapshot["status"];
};
type LegacyContract = Omit<Contract, "status" | "activity"> & {
  status?: Contract["status"];
  activity: (Omit<ContractActivity, "before" | "after"> & {
    before: LegacySnapshot | null;
    after: LegacySnapshot;
  })[];
};
export type LegacyStatusLedger = Omit<Ledger, "contracts"> & {
  contracts: LegacyContract[];
};

export function withoutJobStatus(ledger: Ledger): LegacyStatusLedger {
  const result: LegacyStatusLedger = structuredClone(ledger);
  for (const contract of result.contracts) {
    delete contract.status;
    for (const event of contract.activity) {
      if (event.before) delete event.before.status;
      delete event.after.status;
    }
  }
  return result;
}

export function legacyJobStatusLedger() {
  let ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [{ id: "worker", name: "মিস্ত্রি", kind: "worker" }],
    contracts: [
      {
        id: "job",
        scope: "house",
        personId: "worker",
        title: "দরজার কাজ",
        rate: 200000,
        total: 200000,
        history: [{ at: "old time", total: 100000, note: "আগের লেখা" }],
      },
    ],
  });
  ledger = saveContractChange(
    ledger,
    ContractSchema.parse({
      ...ledger.contracts[0],
      total: 300000,
      rate: 300000,
    }),
    "আরও কাজ যোগ হয়েছে",
    "2026-11-01T00:00:00Z",
  );
  ledger.entries = [
    EntrySchema.parse({
      id: "earned",
      kind: "expense",
      contractId: "job",
      personId: "worker",
      account: "labour",
      date: "2026-11-01",
      lines: [
        { id: "line", workId: "door", costType: "labour", amount: 100000 },
      ],
    }),
    EntrySchema.parse({
      id: "paid",
      kind: "payment",
      contractId: "job",
      personId: "worker",
      account: "labour",
      date: "2026-11-01",
      allocations: [{ workId: "door", amount: 200000 }],
      paymentParts: [{ amount: 200000 }],
    }),
    EntrySchema.parse({
      id: "refund",
      kind: "refund",
      contractId: "job",
      personId: "worker",
      account: "labour",
      date: "2026-11-02",
      allocations: [{ workId: "door", amount: 50000 }],
      paymentParts: [{ amount: 50000 }],
    }),
  ];
  return withoutJobStatus(LedgerSchema.parse(ledger));
}

import { reconciledTotals } from "../../domain/adjustmentMath";
import { effectiveAccounts } from "../../domain/effectiveAccounts";
import { entryWorkIds } from "../../domain/ledger";
import type { Account, Entry, Ledger } from "../../domain/model";
import { partyLedger } from "../../domain/partyLedger";

export type PartyDueItem = {
  id: string;
  billId?: string;
  personId: string;
  account: Account;
  contractId: string | null;
  workId?: string;
  amount: number;
  label: string;
  date?: string;
};
export type PartyDueScope = { workId?: string; account?: Account };
const accounts: Account[] = ["materials", "labour", "other"];

export function partyDueItems(
  ledger: Ledger,
  personId: string,
  scope: PartyDueScope = {},
): PartyDueItem[] {
  if (!ledger.people.some((person) => person.id === personId)) return [];
  const effective = effectiveAccounts(ledger);
  const summary = partyLedger(ledger, personId);
  if (summary.creditAmbiguous) return [];
  const result: PartyDueItem[] = [];
  for (const account of accounts) {
    if (scope.account && scope.account !== account) continue;
    const entries = ledger.entries.filter(
      (entry) =>
        entry.personId === personId && effective.get(entry.id) === account,
    );
    const accountLedger = {
      ...ledger,
      entries,
      contracts: account === "labour" ? ledger.contracts : [],
    };
    // An account scope nets separate contracts; this projection must keep their source balances separate.
    const totals = reconciledTotals(accountLedger, {
      personId,
      ...(scope.workId ? { workId: scope.workId } : {}),
    });
    if (totals.balanceAmbiguous || totals.reconciledPayable <= 0) continue;
    const aggregate = (
      amount: number,
      contractId: string | null,
      source: Entry[],
    ) => {
      const workIds = [
        ...new Set(
          source
            .filter(
              (entry) => !entry.voided && entry.balanceImpact !== "historical",
            )
            .flatMap(entryWorkIds),
        ),
      ];
      const contract = ledger.contracts.find((row) => row.id === contractId);
      const workId =
        scope.workId ??
        (contract?.scope === "work"
          ? (contract.workId ?? undefined)
          : workIds.length === 1
            ? workIds[0]
            : undefined);
      return {
        id: JSON.stringify(["balance", account, contractId, workId ?? null]),
        personId,
        account,
        contractId,
        ...(workId ? { workId } : {}),
        amount,
        label: "বাকির হিসাব",
      } satisfies PartyDueItem;
    };
    const contractIds = accountLedger.contracts
      .filter((contract) => contract.personId === personId)
      .map((contract) => contract.id);
    const buckets = [
      ...new Set([...entries.map((entry) => entry.contractId), ...contractIds]),
    ].map((contractId) => {
      const source = entries.filter((entry) => entry.contractId === contractId);
      const current = reconciledTotals(
        {
          ...accountLedger,
          entries: source,
          contracts: ledger.contracts.filter(
            (contract) => contract.id === contractId,
          ),
        },
        { personId, ...(scope.workId ? { workId: scope.workId } : {}) },
      );
      const bills = summary.bills
        .filter(
          (bill) =>
            effective.get(bill.entry.id) === account &&
            bill.entry.contractId === contractId,
        )
        .flatMap((bill) =>
          bill.works
            .filter(
              (work) =>
                work.outstanding > 0 &&
                (!scope.workId || work.workId === scope.workId),
            )
            .map((work) => ({ bill, work })),
        )
        .sort(
          (a, b) =>
            (a.bill.entry.date ?? "9999").localeCompare(
              b.bill.entry.date ?? "9999",
            ) ||
            a.bill.entry.createdAt.localeCompare(b.bill.entry.createdAt) ||
            a.bill.entry.id.localeCompare(b.bill.entry.id) ||
            a.work.workId.localeCompare(b.work.workId),
        );
      const unmatchedCash = summary.payments.some(
        (payment) =>
          effective.get(payment.entry.id) === account &&
          payment.entry.contractId === contractId &&
          payment.context !== "receivable" &&
          payment.works.some(
            (work) =>
              work.available > 0 &&
              (!scope.workId || work.workId === scope.workId),
          ),
      );
      const correction = source.some(
        (entry) =>
          !entry.voided &&
          entry.kind === "adjustment" &&
          entry.adjustment?.target === "person" &&
          (!scope.workId || entry.adjustment.workId === scope.workId),
      );
      return {
        contractId,
        source,
        amount: current.balanceAmbiguous ? 0 : current.reconciledPayable,
        bills,
        unmatchedCash,
        correction,
      };
    });
    const bucketTotal = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);
    if (bucketTotal !== totals.reconciledPayable) {
      result.push(aggregate(totals.reconciledPayable, null, entries));
      continue;
    }
    for (const bucket of buckets) {
      if (bucket.amount <= 0) continue;
      const billTotal = bucket.bills.reduce(
        (sum, { work }) => sum + work.outstanding,
        0,
      );
      if (
        billTotal !== bucket.amount ||
        bucket.unmatchedCash ||
        bucket.correction
      ) {
        result.push(aggregate(bucket.amount, bucket.contractId, bucket.source));
        continue;
      }
      for (const { bill, work } of bucket.bills)
        result.push({
          id: JSON.stringify([bill.entry.id, work.workId]),
          billId: bill.entry.id,
          personId,
          account: bill.entry.account,
          contractId: bill.entry.contractId,
          workId: work.workId,
          amount: work.outstanding,
          label:
            bill.entry.note ||
            bill.entry.lines
              .filter((line) => line.workId === work.workId)
              .map((line) => line.label)
              .filter(Boolean)
              .join(" · ") ||
            "বিল",
          ...(bill.entry.date ? { date: bill.entry.date } : {}),
        });
    }
  }
  return result;
}

export function partyDuePaymentUrl(
  row: PartyDueItem,
  back: string,
  sourceScope: PartyDueScope = {},
) {
  const params = new URLSearchParams({
    person: row.personId,
    account: row.account,
    contract: row.contractId ?? "none",
    amount: String(row.amount),
    purpose: "settle",
    dueWork: sourceScope.workId ?? "all",
    dueAccount: sourceScope.account ?? "all",
    back,
  });
  if (row.workId) params.set("work", row.workId);
  if (row.billId) params.set("bill", row.billId);
  else params.set("balanceOnly", "1");
  return `/write/payment?${params}`;
}

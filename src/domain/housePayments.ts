import { z } from "zod";
import {
  AccountSchema,
  EntrySchema,
  MoneySchema,
  ReceiptSchema,
  validateLedger,
  type Account,
  type Ledger,
  type Receipt,
} from "./model.js";
import { allocatePayment, partyLedger } from "./partyLedger.js";
import {
  contactEntryPolicy,
  getContactEntryDefaults,
} from "./contactEntryPolicy.js";

const RequestSchema = z.object({
  personId: z.string().min(1).max(160),
  amount: MoneySchema.refine((amount) => amount > 0),
  intent: z.enum(["settlement", "advance", "receivable"]),
  workId: z.string().min(1).max(160).optional(),
  contractId: z.string().min(1).max(160).nullable().optional(),
  account: AccountSchema.optional(),
  confirmUnallocatedCash: z.boolean().optional(),
  allocations: z
    .array(
      z.object({
        billId: z.string().min(1).max(160),
        workId: z.string().min(1).max(160),
        amount: MoneySchema.refine((amount) => amount > 0),
      }),
    )
    .max(1000)
    .optional(),
});
export type HousePaymentRequest = z.infer<typeof RequestSchema>;
export type HousePaymentIssue =
  | "invalid_person"
  | "invalid_amount"
  | "invalid_work"
  | "invalid_contract"
  | "invalid_account"
  | "choose_scope"
  | "unassigned_cash"
  | "unresolved_balance"
  | "invalid_allocation"
  | "contact_rules";
export type HouseBillAllocation = {
  billId: string;
  workId: string;
  amount: number;
};
export type HousePaymentGroup = {
  account: Account;
  contractId: string | null;
  context: "settlement" | "advance" | "receivable";
  amount: number;
  works: { workId: string; amount: number }[];
  allocations: HouseBillAllocation[];
};
export type HousePaymentPlan = {
  input: HousePaymentRequest;
  allocations: HouseBillAllocation[];
  remainder: number;
  groups: HousePaymentGroup[];
  issues: HousePaymentIssue[];
  signature: string;
  earnedPayable: number | null;
  existingUnallocatedCash: number;
  requiresCashReview: boolean;
};

export function planHousePayment(
  ledger: Ledger,
  input: HousePaymentRequest,
): HousePaymentPlan {
  const parsed = RequestSchema.safeParse(input);
  const issues: HousePaymentIssue[] = [];
  const empty: HousePaymentPlan = {
    input,
    allocations: [],
    remainder: 0,
    groups: [],
    issues,
    signature: "",
    earnedPayable: 0,
    existingUnallocatedCash: 0,
    requiresCashReview: false,
  };
  if (!parsed.success) {
    issues.push(
      ...parsed.error.issues.map((issue): HousePaymentIssue =>
        issue.path[0] === "personId"
          ? "invalid_person"
          : issue.path[0] === "account"
            ? "invalid_account"
            : issue.path[0] === "allocations"
              ? "invalid_allocation"
              : "invalid_amount",
      ),
    );
    return empty;
  }
  const request = parsed.data;
  empty.input = request;
  const person = ledger.people.find(
    (row) => row.id === request.personId && !row.archivedAt,
  );
  if (!person) issues.push("invalid_person");
  const policy = person ? contactEntryPolicy(person) : null;
  if (policy && !policy.payment) issues.push("contact_rules");
  const activeWorks = ledger.works.filter((row) => !row.archivedAt);
  if (request.workId && !activeWorks.some((work) => work.id === request.workId))
    issues.push("invalid_work");
  const contract = request.contractId
    ? ledger.contracts.find(
        (row) =>
          row.id === request.contractId &&
          !row.archivedAt &&
          row.personId === request.personId,
      )
    : null;
  if (
    request.contractId &&
    (!contract ||
      (request.workId &&
        contract.scope === "work" &&
        contract.workId !== request.workId))
  )
    issues.push("invalid_contract");
  const summary = partyLedger(ledger, request.personId);
  empty.earnedPayable = summary.earnedPayable;
  const candidates = summary.bills
    .filter(
      (bill) =>
        (!request.account || bill.entry.account === request.account) &&
        (request.contractId === undefined ||
          bill.entry.contractId === request.contractId) &&
        bill.outstanding > 0,
    )
    .sort(
      (a, b) =>
        (a.entry.date ?? "9999").localeCompare(b.entry.date ?? "9999") ||
        a.entry.createdAt.localeCompare(b.entry.createdAt) ||
        a.entry.id.localeCompare(b.entry.id),
    );
  const available = candidates.flatMap((bill) =>
    bill.works
      .filter(
        (work) =>
          work.outstanding > 0 &&
          (!request.workId || work.workId === request.workId),
      )
      .map((work) => ({ bill, work })),
  );
  const unresolvedContracts = new Set(
    ledger.entries
      .filter((entry) => summary.unresolvedAdjustmentIds.includes(entry.id))
      .map((entry) => entry.contractId),
  );
  if (
    request.intent === "settlement" &&
    summary.unresolvedAdjustmentIds.length &&
    (!available.length ||
      available.some(({ bill }) =>
        unresolvedContracts.has(bill.entry.contractId),
      ))
  )
    issues.push("unresolved_balance");
  const groups = new Map<string, HousePaymentGroup>();
  const groupFor = (
    account: Account,
    contractId: string | null,
    context: HousePaymentGroup["context"],
  ) => {
    const key = JSON.stringify([account, contractId, context]);
    let group = groups.get(key);
    if (!group) {
      group = {
        account,
        contractId,
        context,
        amount: 0,
        works: [],
        allocations: [],
      };
      groups.set(key, group);
    }
    return group;
  };
  const addAmount = (
    group: HousePaymentGroup,
    workId: string,
    amount: number,
  ) => {
    group.amount += amount;
    const work = group.works.find((row) => row.workId === workId);
    if (work) work.amount += amount;
    else group.works.push({ workId, amount });
  };
  let remainder = request.amount;
  if (request.intent === "settlement") {
    const explicit = request.allocations;
    const selected =
      explicit ??
      available.flatMap(({ bill, work }) => {
        const amount = Math.min(remainder, work.outstanding);
        remainder -= amount;
        return amount
          ? [{ billId: bill.entry.id, workId: work.workId, amount }]
          : [];
      });
    if (explicit) remainder = request.amount;
    const assigned = new Map<string, number>();
    for (const row of selected) {
      const target = available.find(
        ({ bill, work }) =>
          bill.entry.id === row.billId && work.workId === row.workId,
      );
      const key = JSON.stringify([row.billId, row.workId]);
      const amount = (assigned.get(key) ?? 0) + row.amount;
      assigned.set(key, amount);
      if (
        !target ||
        amount > target.work.outstanding ||
        (explicit && row.amount > remainder)
      ) {
        issues.push("invalid_allocation");
        continue;
      }
      if (explicit) remainder -= row.amount;
      const group = groupFor(
        target.bill.entry.account,
        target.bill.entry.contractId,
        "settlement",
      );
      group.allocations.push(row);
      addAmount(group, row.workId, row.amount);
      empty.allocations.push(row);
    }
    const scopes = new Set(
      available.map(({ bill, work }) =>
        JSON.stringify([
          bill.entry.account,
          bill.entry.contractId,
          work.workId,
        ]),
      ),
    );
    const existingCash = summary.payments.filter(
      (payment) =>
        payment.available > 0 &&
        payment.works.some(
          (work) =>
            work.available > 0 &&
            scopes.has(
              JSON.stringify([
                payment.entry.account,
                payment.entry.contractId,
                work.workId,
              ]),
            ),
        ),
    );
    empty.existingUnallocatedCash = existingCash.reduce(
      (sum, payment) =>
        sum +
        payment.works
          .filter((work) =>
            scopes.has(
              JSON.stringify([
                payment.entry.account,
                payment.entry.contractId,
                work.workId,
              ]),
            ),
          )
          .reduce((total, work) => total + work.available, 0),
      0,
    );
    empty.requiresCashReview = empty.existingUnallocatedCash > 0;
    if (empty.requiresCashReview && !request.confirmUnallocatedCash)
      issues.push("unassigned_cash");
  }
  if (remainder > 0) {
    const inferredScopes = [
      ...new Map(
        available.map(({ bill, work }) => [
          JSON.stringify([
            bill.entry.account,
            bill.entry.contractId,
            work.workId,
          ]),
          {
            account: bill.entry.account,
            contractId: bill.entry.contractId,
            workId: work.workId,
          },
        ]),
      ).values(),
    ];
    const inferred =
      inferredScopes.length === 1 ? inferredScopes[0] : undefined;
    const workId =
      request.workId ??
      contract?.workId ??
      inferred?.workId ??
      (person
        ? getContactEntryDefaults(ledger, person).workId || undefined
        : undefined) ??
      (activeWorks.length === 1 ? activeWorks[0].id : undefined);
    const account =
      request.account ??
      (contract
        ? "labour"
        : (inferred?.account ??
          (request.intent === "settlement"
            ? policy?.accounts.length === 1
              ? policy.accounts[0]
              : undefined
            : policy?.defaultAccount)));
    const contractId = request.contractId ?? inferred?.contractId ?? null;
    if (!workId || !account || (contractId && account !== "labour"))
      issues.push("choose_scope");
    else if (
      policy &&
      (!policy.accounts.includes(account) || (contractId && !policy.agreement))
    )
      issues.push("contact_rules");
    else
      addAmount(
        groupFor(
          account,
          contractId,
          request.intent === "receivable" ? "receivable" : "advance",
        ),
        workId,
        remainder,
      );
  }
  empty.remainder = remainder;
  empty.groups = [...groups.values()];
  empty.issues = [...new Set(issues)];
  const { confirmUnallocatedCash: _confirmedCash, ...financialInput } = request;
  empty.signature = JSON.stringify({
    input: financialInput,
    allocations: empty.allocations,
    groups: empty.groups,
    available: available.map(({ bill, work }) => [
      bill.entry.id,
      bill.entry.account,
      bill.entry.contractId,
      work.workId,
      work.outstanding,
    ]),
    cash: summary.payments.map((payment) => [
      payment.entry.id,
      payment.entry.account,
      payment.entry.contractId,
      payment.context,
      payment.works,
    ]),
    payable: summary.payable,
    policy: person ? { ...policy, workIds: person.workIds } : null,
  });
  return empty;
}

export type HousePaymentInput = HousePaymentRequest & {
  id: string;
  date: string;
  method: "cash" | "bkash" | "bank" | "other";
  note?: string;
  receipts?: Receipt[];
  confirmRemainderAdvance?: boolean;
  expectedPlan?: HousePaymentPlan;
};

export function recordHousePayment(
  ledger: Ledger,
  input: HousePaymentInput,
  expectedPlan = input.expectedPlan,
): Ledger {
  const current = validateLedger(ledger);
  const plan = planHousePayment(current, input);
  if (plan.issues.length) throw new Error(`house_payment_${plan.issues[0]}`);
  if (expectedPlan && plan.signature !== expectedPlan.signature)
    throw new Error("house_payment_changed");
  if (
    input.intent === "settlement" &&
    plan.remainder > 0 &&
    !input.confirmRemainderAdvance
  )
    throw new Error("house_payment_confirm_advance");
  if (
    !input.id ||
    input.id.length > 150 ||
    plan.groups.reduce((sum, group) => sum + group.amount, 0) !== input.amount
  )
    throw new Error("house_payment_invalid_amount");
  const receipts = z
    .array(ReceiptSchema)
    .max(30)
    .parse(input.receipts ?? []);
  const now = new Date().toISOString();
  const rows = plan.groups.map((group, index) =>
    EntrySchema.parse({
      id: plan.groups.length === 1 ? input.id : `${input.id}:${index}`,
      kind: "payment",
      personId: input.personId,
      account: group.account,
      contractId: group.contractId,
      date: input.date,
      note: input.note ?? "",
      paymentContext: group.context,
      allocations: group.works,
      paymentParts: [{ method: input.method, amount: group.amount }],
      receipts: index === 0 ? receipts : [],
      createdAt: now,
      updatedAt: now,
    }),
  );
  const next = validateLedger({
    ...current,
    entries: [...current.entries, ...rows],
  });
  const allocations = plan.groups.flatMap((group, index) =>
    group.allocations.map((allocation, position) => ({
      id: `${rows[index].id}:a${position}`,
      paymentId: rows[index].id,
      billId: allocation.billId,
      workId: allocation.workId,
      amount: allocation.amount,
      createdAt: now,
    })),
  );
  return allocatePayment(next, allocations);
}

export type HouseBillAdvanceRequest = {
  personId: string;
  account: Account;
  workId: string;
  contractId?: string | null;
  amount: number;
};
export function planHouseBillAdvance(
  ledger: Ledger,
  input: HouseBillAdvanceRequest,
) {
  const source = partyLedger(ledger, input.personId).payments.filter(
    (payment) =>
      payment.context === "advance" &&
      payment.entry.account === input.account &&
      payment.entry.contractId === (input.contractId ?? null),
  );
  let remainder =
    Number.isSafeInteger(input.amount) && input.amount > 0 ? input.amount : 0;
  const allocations = source.flatMap((payment) => {
    const available =
      payment.works.find((work) => work.workId === input.workId)?.available ??
      0;
    const amount = Math.min(remainder, available);
    remainder -= amount;
    return amount
      ? [{ paymentId: payment.id, workId: input.workId, amount }]
      : [];
  });
  return {
    input,
    allocations,
    applied: input.amount - remainder,
    remainder,
    signature: JSON.stringify({
      input,
      sources: source.map((payment) => [payment.id, payment.works]),
    }),
  };
}
export function applyHouseBillAdvance(
  ledger: Ledger,
  billId: string,
  expected: ReturnType<typeof planHouseBillAdvance>,
): Ledger {
  const current = validateLedger(ledger);
  const plan = planHouseBillAdvance(current, expected.input);
  if (plan.signature !== expected.signature)
    throw new Error("house_advance_changed");
  const bill = current.entries.find((entry) => entry.id === billId);
  if (
    !bill ||
    bill.personId !== plan.input.personId ||
    bill.account !== plan.input.account ||
    bill.contractId !== (plan.input.contractId ?? null) ||
    bill.kind !== "expense" ||
    !Number.isSafeInteger(plan.input.amount) ||
    plan.input.amount <= 0
  )
    throw new Error("house_advance_invalid_bill");
  const now = new Date().toISOString();
  return allocatePayment(
    current,
    plan.allocations.map((row) => ({
      id: crypto.randomUUID(),
      paymentId: row.paymentId,
      billId,
      workId: row.workId,
      amount: row.amount,
      createdAt: now,
    })),
  );
}

export const proposeHousePayment = planHousePayment;
export const applyHousePayment = recordHousePayment;

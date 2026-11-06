import { z } from "zod";

export const SHARED_PAGE_SIZE = 20;
export const SHARED_QUERY_MAX_LENGTH = 200;
export const SHARED_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const SHARED_RECEIPT_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

const SafeAmount = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const NonnegativeAmount = SafeAmount.refine((value) => value >= 0);
const SharedDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();
const SharedSettlementSchema = z.object({
  paid: NonnegativeAmount,
  returned: NonnegativeAmount,
  refunded: NonnegativeAmount,
  balance: SafeAmount,
  paymentCount: z.number().int().nonnegative().max(100000),
});
export const SharedStatementSchema = z.object({
  person: z.object({
    name: z.string().max(200),
    role: z.string().max(200),
    kind: z.enum(["shop", "worker", "driver", "other"]).default("other"),
  }),
  projectName: z.string().max(200),
  account: z.enum(["materials", "labour", "other"]),
  workName: z.string().max(200),
  updatedAt: z.string().datetime({ offset: true }),
  revision: z.number().int().positive(),
  total: z.number().int().nonnegative().max(100000),
  nextOffset: z.number().int().nonnegative().max(100000).nullable(),
  totals: z.object({
    cost: SafeAmount,
    paid: SafeAmount,
    payable: SafeAmount,
    advance: SafeAmount,
    historicalCost: SafeAmount,
    adjustment: SafeAmount.optional(),
    costCorrection: SafeAmount.optional(),
    paidCorrection: SafeAmount.optional(),
    balanceCorrection: SafeAmount.optional(),
    reconciledCost: SafeAmount.optional(),
    reconciledNetPaid: SafeAmount.optional(),
    reconciledBalance: SafeAmount.optional(),
    reconciledPayable: SafeAmount.optional(),
    reconciledAdvance: SafeAmount.optional(),
    actualCost: SafeAmount.optional(),
    actualPaid: SafeAmount.optional(),
    actualRefunds: SafeAmount.optional(),
    actualNetPaid: SafeAmount.optional(),
    balanceAmbiguous: z.boolean().optional(),
    earnedPayable: SafeAmount.nullable().optional(),
  }),
  counts: z
    .object({
      expense: z.number().int().nonnegative().max(100000).default(0),
      payment: z.number().int().nonnegative().max(100000).default(0),
      expense_credit: z.number().int().nonnegative().max(100000).default(0),
      refund: z.number().int().nonnegative().max(100000).default(0),
      adjustment: z.number().int().nonnegative().max(100000).optional(),
    })
    .default({ expense: 0, payment: 0, expense_credit: 0, refund: 0 }),
  contracts: z
    .array(
      z.object({
        title: z.string().max(300),
        status: z.enum(["planned", "ongoing", "done"]).nullable().optional(),
        workName: z.string().max(200),
        total: SafeAmount.refine((value) => value >= 0),
        netPaid: SafeAmount,
        remaining: SafeAmount.refine((value) => value >= 0),
        remainingCommitment: NonnegativeAmount.optional(),
        unearnedCommitment: NonnegativeAmount.optional(),
      }),
    )
    .max(10000)
    .default([]),
  rows: z
    .array(
      z
        .object({
          key: z.string().max(160),
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .nullable(),
          kind: z.enum([
            "expense",
            "payment",
            "expense_credit",
            "refund",
            "adjustment",
          ]),
          historical: z.boolean(),
          charge: SafeAmount,
          paid: SafeAmount,
          adjustment: SafeAmount.optional(),
          adjustmentBasis: z
            .enum(["paid", "cost", "balance"])
            .nullable()
            .optional(),
          description: z.string().max(310000),
          works: z.string().max(210000),
          settlement: SharedSettlementSchema.optional(),
        })
        .superRefine((row, ctx) => {
          if (
            row.kind === "adjustment"
              ? !row.adjustment ||
                !row.adjustmentBasis ||
                row.charge !== 0 ||
                row.paid !== 0 ||
                row.historical
              : Boolean(row.adjustment) || Boolean(row.adjustmentBasis)
          )
            ctx.addIssue({
              code: "custom",
              path: ["adjustment"],
              message: "Invalid noncash adjustment row",
            });
          if (row.settlement) {
            const settlement = row.settlement;
            if (
              ![
                row.charge,
                settlement.paid,
                settlement.returned,
                settlement.refunded,
                settlement.balance,
              ].every(Number.isSafeInteger)
            )
              return;
            if (
              row.kind !== "expense" ||
              row.historical ||
              row.charge <= 0 ||
              row.paid !== 0 ||
              settlement.paid > 0 !== settlement.paymentCount > 0 ||
              BigInt(row.charge) -
                BigInt(settlement.returned) -
                BigInt(settlement.paid) +
                BigInt(settlement.refunded) !==
                BigInt(settlement.balance)
            )
              ctx.addIssue({
                code: "custom",
                path: ["settlement"],
                message: "Invalid bill settlement",
              });
          }
        }),
    )
    .max(60),
});
export type SharedStatement = z.infer<typeof SharedStatementSchema>;

export type SharedKind = SharedStatement["rows"][number]["kind"];
const SharedMethodSchema = z.enum(["cash", "bkash", "bank", "other"]);
const SharedPaymentPartSchema = z.object({
  method: SharedMethodSchema,
  amount: NonnegativeAmount,
});
const SharedLineSchema = z.object({
  label: z.string().max(300),
  amount: NonnegativeAmount,
  workName: z.string().max(200),
  quantity: z
    .number()
    .finite()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  unit: z.string().max(60).optional(),
});
const SharedPaymentSchema = z
  .object({
    key: z.string().min(1).max(160),
    date: SharedDate,
    paid: NonnegativeAmount,
    description: z.string().max(310000),
    paymentParts: z.array(SharedPaymentPartSchema).max(100),
    paymentMethods: z.array(SharedMethodSchema).max(4),
  })
  .superRefine((payment, ctx) => {
    if (
      ![payment.paid, ...payment.paymentParts.map((part) => part.amount)].every(
        Number.isSafeInteger,
      )
    )
      return;
    if (
      payment.paymentParts.length &&
      payment.paymentParts.reduce(
        (sum, part) => sum + BigInt(part.amount),
        0n,
      ) !== BigInt(payment.paid)
    )
      ctx.addIssue({
        code: "custom",
        path: ["paymentParts"],
        message: "Payment parts must match scoped amount",
      });
  });
export const SharedPaymentsPageSchema = z.object({
  key: z.string().min(1).max(160),
  revision: z.number().int().positive(),
  total: z.number().int().nonnegative().max(100000),
  nextOffset: z.number().int().nonnegative().max(100000).nullable(),
  payments: z.array(SharedPaymentSchema).max(SHARED_PAGE_SIZE),
});
export type SharedPaymentsPage = z.infer<typeof SharedPaymentsPageSchema>;

export function validateSharedPaymentsPage(
  page: SharedPaymentsPage,
  entryId: string,
  revision: number,
  offset: number,
) {
  if (page.revision !== revision) throw new Error("share_changed");
  const end = offset + page.payments.length;
  if (
    page.key !== entryId ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    page.payments.length > SHARED_PAGE_SIZE ||
    new Set(page.payments.map((payment) => payment.key)).size !==
      page.payments.length ||
    end > page.total ||
    (end < page.total
      ? !page.payments.length || page.nextOffset !== end
      : page.nextOffset !== null)
  )
    throw new Error("share_invalid_page");
  return page;
}
export const SharedEntrySchema = SharedStatementSchema.shape.rows.element
  .safeExtend({
    key: z.string().min(1).max(160),
    revision: z.number().int().positive(),
    note: z.string().max(10000),
    paymentParts: z.array(SharedPaymentPartSchema).max(100),
    paymentMethods: z.array(SharedMethodSchema).max(4),
    lines: z.array(SharedLineSchema).max(1000),
    payments: z.array(SharedPaymentSchema).max(SHARED_PAGE_SIZE).optional(),
    paymentsTotal: z.number().int().nonnegative().max(100000).optional(),
    paymentsNextOffset: z
      .number()
      .int()
      .nonnegative()
      .max(100000)
      .nullable()
      .optional(),
    relatedBill: z
      .object({
        key: z.string().min(1).max(160),
        date: SharedDate,
        charge: NonnegativeAmount,
        lines: z.array(SharedLineSchema).max(1000),
      })
      .optional(),
    receipts: z
      .array(
        z.object({
          id: z.string().min(1).max(160),
          name: z.string().min(1).max(300),
          mime: z.enum(SHARED_RECEIPT_MIMES),
          size: z
            .number()
            .int()
            .positive()
            .max(25 * 1024 * 1024),
        }),
      )
      .max(30),
  })
  .superRefine((entry, ctx) => {
    const paged =
      entry.paymentsTotal !== undefined ||
      entry.paymentsNextOffset !== undefined;
    if (
      paged &&
      (entry.paymentsTotal === undefined ||
        entry.paymentsNextOffset === undefined ||
        !entry.payments ||
        !entry.settlement ||
        entry.payments.length > SHARED_PAGE_SIZE ||
        entry.paymentsTotal !== entry.settlement.paymentCount ||
        entry.payments.length > entry.paymentsTotal ||
        (entry.payments.length < entry.paymentsTotal
          ? !entry.payments.length ||
            entry.paymentsNextOffset !== entry.payments.length
          : entry.paymentsNextOffset !== null))
    )
      ctx.addIssue({
        code: "custom",
        path: ["payments"],
        message: "Invalid bill payment page",
      });
    if (Boolean(entry.settlement) !== (entry.payments !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["payments"],
        message:
          "Bill settlement and payment history must be provided together",
      });
    if (
      ![
        entry.charge,
        ...entry.lines.map((line) => line.amount),
        ...(entry.relatedBill
          ? [
              entry.relatedBill.charge,
              ...entry.relatedBill.lines.map((line) => line.amount),
            ]
          : []),
        ...(entry.payments?.map((payment) => payment.paid) ?? []),
        ...(entry.settlement ? [entry.settlement.paid] : []),
      ].every(Number.isSafeInteger)
    )
      return;
    const lineSum = (lines: z.infer<typeof SharedLineSchema>[]) =>
      lines.reduce((sum, line) => sum + BigInt(line.amount), 0n);
    if (
      entry.lines.length &&
      lineSum(entry.lines) !== BigInt(Math.abs(entry.charge))
    )
      ctx.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Bill lines must match scoped amount",
      });
    if (
      entry.relatedBill &&
      (entry.kind !== "payment" ||
        lineSum(entry.relatedBill.lines) !== BigInt(entry.relatedBill.charge))
    )
      ctx.addIssue({
        code: "custom",
        path: ["relatedBill"],
        message: "Invalid related bill",
      });
    if (
      entry.payments &&
      (entry.kind !== "expense" ||
        entry.historical ||
        new Set(entry.payments.map((payment) => payment.key)).size !==
          entry.payments.length ||
        entry.payments.reduce(
          (sum, payment) => sum + BigInt(payment.paid),
          0n,
        ) > BigInt(Number.MAX_SAFE_INTEGER) ||
        (entry.settlement &&
          ((!paged &&
            entry.payments.length !== entry.settlement.paymentCount) ||
            (paged && entry.paymentsTotal !== entry.settlement.paymentCount) ||
            entry.payments.reduce(
              (sum, payment) => sum + BigInt(payment.paid),
              0n,
            ) > BigInt(entry.settlement.paid) ||
            ((!paged || entry.paymentsNextOffset === null) &&
              entry.payments.reduce(
                (sum, payment) => sum + BigInt(payment.paid),
                0n,
              ) !== BigInt(entry.settlement.paid)))))
    )
      ctx.addIssue({
        code: "custom",
        path: ["payments"],
        message: "Invalid bill payment history",
      });
  });
export type SharedEntry = z.infer<typeof SharedEntrySchema>;

export function appendSharedPayments(
  entry: SharedEntry,
  page: SharedPaymentsPage,
): SharedEntry {
  const offset = entry.paymentsNextOffset;
  if (!entry.settlement || offset == null || offset !== entry.payments?.length)
    throw new Error("share_invalid_page");
  validateSharedPaymentsPage(page, entry.key, entry.revision, offset);
  const payments = [...entry.payments, ...page.payments];
  const paid = payments.reduce(
    (sum, payment) => sum + BigInt(payment.paid),
    0n,
  );
  if (
    page.total !== entry.paymentsTotal ||
    new Set(payments.map((payment) => payment.key)).size !== payments.length ||
    paid > BigInt(entry.settlement.paid) ||
    (page.nextOffset === null && paid !== BigInt(entry.settlement.paid))
  )
    throw new Error("share_invalid_page");
  return { ...entry, payments, paymentsNextOffset: page.nextOffset };
}

export function validateSharedPage(
  page: SharedStatement,
  offset: number,
  expectedRevision?: number,
  kind?: SharedKind,
): SharedStatement {
  if (expectedRevision !== undefined && page.revision !== expectedRevision)
    throw new Error("share_changed");
  const end = offset + page.rows.length;
  const keys = new Set(page.rows.map((row) => row.key));
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 100000 ||
    page.rows.length > SHARED_PAGE_SIZE ||
    keys.size !== page.rows.length ||
    page.rows.some((row) => !row.key.length || (kind && row.kind !== kind)) ||
    end > page.total ||
    (end < page.total
      ? !page.rows.length || page.nextOffset !== end
      : page.nextOffset !== null)
  )
    throw new Error("share_invalid_page");
  return page;
}

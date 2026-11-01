import { z } from "zod";

const SafeAmount = z
  .number()
  .int()
  .min(-Number.MAX_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
export const SharedStatementSchema = z.object({
  person: z.object({ name: z.string().max(200), role: z.string().max(200) }),
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
  }),
  rows: z
    .array(
      z.object({
        key: z.string().max(160),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        kind: z.enum(["expense", "payment", "expense_credit", "refund"]),
        historical: z.boolean(),
        charge: SafeAmount,
        paid: SafeAmount,
        description: z.string().max(310000),
        works: z.string().max(210000),
      }),
    )
    .max(60),
});
export type SharedStatement = z.infer<typeof SharedStatementSchema>;

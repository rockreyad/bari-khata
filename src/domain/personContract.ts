import {
  ContractSchema,
  LedgerSchema,
  PersonSchema,
  type Ledger,
  type Person,
} from "./model";
import { parseAmount } from "./ledger";
import { personKind } from "./contacts";
export function savePersonWithContract(
  ledger: Ledger,
  person: Person,
  contract?: { id: string; workId: string; amount: string },
) {
  const next = structuredClone(ledger);
  const parsed = PersonSchema.parse(person);
  next.people = [...next.people.filter((p) => p.id !== parsed.id), parsed];
  if (contract?.amount.trim()) {
    const total = parseAmount(contract.amount);
    if (
      personKind(parsed) !== "worker" ||
      !total ||
      !next.works.some((w) => w.id === contract.workId)
    )
      throw new Error("contract");
    if (next.contracts.some((c) => c.id === contract.id))
      throw new Error("duplicate_contract");
    next.contracts.push(
      ContractSchema.parse({
        id: contract.id,
        personId: parsed.id,
        workId: contract.workId,
        title: "মোট মজুরির চুক্তি",
        basis: "fixed",
        quantity: "1",
        rate: total,
        total,
      }),
    );
  }
  return LedgerSchema.parse(next);
}

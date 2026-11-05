import { createContext, useContext } from "react";
import type { Ledger, Account, CostType } from "../domain/model";
import type { ReceiptInput } from "../data/repository";
import type { useLedger } from "../data/useLedger";

export type AddOptions = {
  kind?: "expense" | "payment" | "refund" | "return" | "wage";
  workId?: string;
  personId?: string;
  editId?: string;
  account?: Account;
  costType?: CostType;
  purpose?: "settle" | "advance" | "wage" | "charge";
  contractId?: string;
  milestoneId?: string;
};
export type NotebookContextValue = {
  ledger: Ledger;
  state: ReturnType<typeof useLedger>;
  mode: "real" | "demo";
  base: string;
  go: (path: string, options?: { replace?: boolean }) => void;
  add: (options?: AddOptions) => void;
  quick: () => void;
  entity: (
    kind: "work" | "person" | "contract",
    id?: string,
    workId?: string,
    personId?: string,
  ) => void;
  detail: (id: string) => void;
  close: () => void;
  save: (
    change: Ledger | ((ledger: Ledger) => Ledger),
    files?: ReceiptInput[],
  ) => Promise<void>;
  notify: (text: string, error?: boolean) => void;
};
export const NotebookContext = createContext<NotebookContextValue | null>(null);
export function useNotebook() {
  const value = useContext(NotebookContext);
  if (!value) throw new Error("NotebookProvider is missing");
  return value;
}

import { contractAppliesToWork } from "../domain/contracts";
import { EntryFrame } from "./EntryFrame";
import { numericDraftText, moneyInputValue } from "../lib/numericFields";
import { NumericInput } from "./ui/NumericInput";
import { latinDigits } from "../lib/numerals";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Camera, Plus, Receipt, Trash2, Wallet, Wrench } from "lucide-react";
import { z } from "zod";
import { useLanguageContext } from "../context/LanguageProvider";
import { createWorkspaceStorage } from "../data/repository";
import {
  LedgerSchema,
  ItemSchema,
  type Entry,
  type Ledger,
} from "../domain/model";
import { canAssignContact } from "../domain/contacts";
import { parseAmount, replaceEntry } from "../domain/ledger";
import { AppCombobox } from "./ui/AppCombobox";
import { AppSelect } from "./ui/AppSelect";
import { AppDatePicker } from "./ui/AppDatePicker";
import { MoneyInput } from "./ui/MoneyInput";
import { PersonSchema } from "../domain/model";
import { Sheet } from "./Sheet";
import { FormError, useFormError } from "./ui/FormError";

const kinds = ["purchase", "labour", "payment", "refund", "return"] as const;
type FormKind = (typeof kinds)[number];
const costTypes = [
  "material",
  "labour",
  "transport",
  "unload",
  "rental",
  "other",
] as const;
const costNames: Record<(typeof costTypes)[number], string> = {
  material: "মালামাল",
  labour: "মজুরি",
  transport: "গাড়িভাড়া",
  unload: "মাল নামানো",
  rental: "ভাড়া",
  other: "অন্যান্য",
};
const kindNames: Record<FormKind, string> = {
  purchase: "মাল কিনেছি",
  labour: "মজুরির হিসাব",
  payment: "টাকা দিয়েছি",
  refund: "টাকা ফেরত পেয়েছি",
  return: "মাল ফেরত দিয়েছি",
};
const MethodSchema = z.object({
  method: z.enum(["cash", "bkash", "bank", "other"]),
  amount: numericDraftText(),
});
const RowSchema = z.object({
  id: z.string(),
  workId: z.string(),
  name: z.string(),
  itemId: z.string(),
  costType: z.enum(costTypes),
  amount: numericDraftText(),
  quantity: numericDraftText(),
  unit: z.string(),
});
const DraftSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  kind: z.enum(kinds),
  date: z.string(),
  unknownDate: z.boolean(),
  workId: z.string(),
  personId: z.string(),
  contractId: z.string(),
  account: z.enum(["materials", "labour", "other"]),
  amount: numericDraftText(),
  note: z.string(),
  workerPaid: z.boolean(),
  paidNow: z.boolean(),
  paidAmount: numericDraftText(),
  split: z.boolean().default(false),
  newPersonId: z.string().default(""),
  newPersonName: z.string().default(""),
  relatedEntryId: z.string().default(""),
  entryUpdatedAt: z.string().default(""),
  rows: z.array(RowSchema).min(1),
  methods: z.array(MethodSchema).min(1),
});
type Draft = z.infer<typeof DraftSchema>;
type DraftRow = z.infer<typeof RowSchema>;
export type EntryAttachments = {
  entryId: string;
  files: Array<{ id: string; file: File }>;
};
export type EntrySheetProps = {
  presentation?: "sheet" | "page";
  ledger: Ledger;
  defaultWorkId?: string;
  defaultPersonId?: string;
  initialKind?: string;
  initialAccount?: "materials" | "labour" | "other";
  editEntryId?: string;
  mode?: "real" | "demo";
  onSave: (nextLedger: Ledger, attachments?: EntryAttachments) => Promise<void>;
  onClose: () => void;
};

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function poisha(value: string) {
  try {
    return parseAmount(value);
  } catch {
    return NaN;
  }
}

function newRow(
  workId = "",
  costType: DraftRow["costType"] = "material",
): DraftRow {
  return {
    id: crypto.randomUUID(),
    workId,
    name: "",
    itemId: "",
    costType,
    amount: "",
    quantity: "",
    unit: "",
  };
}

function startDraft(
  workId: string,
  personId: string,
  initialKind?: string,
  initialAccount?: Draft["account"],
): Draft {
  const kind: FormKind =
    initialKind === "labour_bill" || initialKind === "labour"
      ? "labour"
      : initialKind === "payment"
        ? "payment"
        : initialKind === "refund"
          ? "refund"
          : initialKind === "return"
            ? "return"
            : "purchase";
  const workerPaid = initialKind === "worker_purchase";
  return {
    id: crypto.randomUUID(),
    paymentId: crypto.randomUUID(),
    kind,
    date: today(),
    unknownDate: false,
    workId,
    personId,
    contractId: "",
    relatedEntryId: "",
    entryUpdatedAt: "",
    account:
      kind === "payment" || kind === "refund"
        ? (initialAccount ?? "materials")
        : kind === "labour"
          ? "labour"
          : "materials",
    amount: "",
    note: "",
    workerPaid,
    paidNow: kind === "purchase" && !workerPaid,
    paidAmount: "",
    split: false,
    newPersonId: crypto.randomUUID(),
    newPersonName: "",
    rows: [newRow(workId, kind === "labour" ? "labour" : "material")],
    methods: [{ method: "cash", amount: "" }],
  };
}

function editDraft(entry: Entry): Draft {
  const workId = entry.lines[0]?.workId ?? entry.allocations[0]?.workId ?? "";
  const initial = startDraft(workId, entry.personId ?? "");
  return {
    ...initial,
    id: entry.id,
    kind:
      entry.kind === "payment"
        ? "payment"
        : entry.kind === "refund"
          ? "refund"
          : entry.kind === "expense_credit"
            ? "return"
            : entry.account === "labour"
              ? "labour"
              : "purchase",
    date: entry.date ?? today(),
    unknownDate: !entry.date,
    contractId: entry.contractId ?? "__none__",
    relatedEntryId: entry.relatedEntryId ?? "",
    entryUpdatedAt: entry.updatedAt,
    account: entry.account,
    note: entry.note,
    paidNow: false,
    amount: moneyInputValue(
      entry.paymentParts.reduce((sum, part) => sum + part.amount, 0),
    ),
    split: entry.allocations.length > 1,
    rows: entry.lines.length
      ? entry.lines.map((line) => ({
          id: line.id,
          workId: line.workId,
          name: line.label,
          itemId: line.itemId ?? "",
          costType: line.costType,
          amount: moneyInputValue(line.amount),
          quantity: line.quantity,
          unit: line.unit,
        }))
      : entry.allocations.length
        ? entry.allocations.map((allocation) => ({
            ...newRow(allocation.workId),
            amount: moneyInputValue(allocation.amount),
          }))
        : initial.rows,
    methods: entry.paymentParts.length
      ? entry.paymentParts.map((part) => ({
          method: part.method,
          amount: moneyInputValue(part.amount),
        }))
      : initial.methods,
  };
}

export function EntrySheet({
  presentation = "sheet",
  ledger,
  defaultWorkId,
  defaultPersonId,
  initialKind,
  initialAccount,
  editEntryId,
  mode = "real",
  onSave,
  onClose,
}: EntrySheetProps) {
  const storage = useMemo(() => createWorkspaceStorage(mode), [mode]);
  const { t, money, number, formatDigits } = useLanguageContext();
  const original = ledger.entries.find((entry) => entry.id === editEntryId);
  const draftKey = `entry:${editEntryId ?? `${defaultWorkId ?? "all"}:${defaultPersonId ?? "all"}:${initialKind ?? "purchase"}`}`;
  const [draft, setDraft] = useState<Draft>(() =>
    original
      ? editDraft(original)
      : startDraft(
          defaultWorkId ??
            ledger.works.find((work) => !work.archivedAt)?.id ??
            "",
          defaultPersonId ?? "",
          initialKind,
          initialAccount,
        ),
  );
  const [files, setFiles] = useState<Array<{ id: string; file: File }>>([]);
  const [ready, setReady] = useState(false);
  const [, setError, errorNotice] = useFormError();
  const [draftNotice, setDraftNotice] = useState("");
  const [draftConflict, setDraftConflict] = useState<
    "changed" | "mismatch" | null
  >(null);
  const [saving, setSaving] = useState(false);
  const [processingFiles, setProcessingFiles] = useState(false);
  const lock = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(false);
  const hydrated = useRef(false);
  const finished = useRef(false);
  const queue = useRef(Promise.resolve());
  const latest = useRef({ draft, files });
  latest.current = { draft, files };
  const queueDraft = useCallback(
    (value: { draft: Draft; files: Array<{ id: string; file: File }> }) => {
      const next = queue.current
        .catch(() => {})
        .then(async () => {
          await storage.saveDraft(draftKey, value);
        });
      queue.current = next;
      return next;
    },
    [draftKey, storage],
  );
  const isCash = draft.kind === "payment" || draft.kind === "refund";
  const isLabour =
    draft.kind === "labour" || (!isCash && draft.account === "labour");
  const lineTotal = draft.rows.reduce(
    (sum, row) => sum + (poisha(row.amount) || 0),
    0,
  );
  const cashTotal = isCash
    ? draft.split
      ? lineTotal
      : poisha(draft.amount) || 0
    : draft.paidNow
      ? poisha(draft.paidAmount.trim() || moneyInputValue(lineTotal)) || 0
      : 0;
  const eligibleContracts = ledger.contracts.filter(
    (contract) =>
      (!contract.archivedAt ||
        (Boolean(original) && contract.id === original?.contractId)) &&
      contractAppliesToWork(contract, draft.workId) &&
      contract.personId === draft.personId,
  );
  const selectedContractId =
    draft.contractId === "__none__"
      ? ""
      : draft.contractId ||
        (eligibleContracts.length === 1 ? eligibleContracts[0].id : "");
  const relatedBills = ledger.entries.filter(
    (entry) =>
      entry.kind === "expense" &&
      !entry.voided &&
      entry.id !== original?.id &&
      entry.account === draft.account,
  );
  const hasLinkedPayments = Boolean(
    original?.kind === "expense" &&
    ledger.entries.some(
      (entry) => entry.relatedEntryId === original.id && !entry.voided,
    ),
  );

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let read = false;
    void storage
      .readDraft<unknown>(draftKey)
      .then((value) => {
        if (!active) return;
        read = true;
        if (!value || typeof value !== "object") return;
        const saved = value as { draft?: unknown; files?: unknown };
        const parsed = DraftSchema.safeParse(saved.draft);
        if (!parsed.success) return;
        if (
          original &&
          (parsed.data.id !== original.id ||
            parsed.data.kind !== editDraft(original).kind)
        ) {
          read = false;
          setDraftConflict("mismatch");
          setDraftNotice(
            t("অসমাপ্ত লেখাটি এই হিসাবের সঙ্গে মিলছে না। আগের লেখা রাখা আছে।"),
          );
          return;
        }
        const changed = Boolean(
          original && parsed.data.entryUpdatedAt !== original.updatedAt,
        );
        if (changed) {
          read = false;
          setDraftConflict("changed");
        }
        if (
          !original &&
          ledger.entries.some((entry) => entry.id === parsed.data.id)
        ) {
          void storage.removeDraft(draftKey);
          return;
        }
        setDraft(parsed.data);
        if (Array.isArray(saved.files)) {
          const restored = saved.files.filter(
            (item): item is { id: string; file: Blob & { name?: string } } =>
              typeof item === "object" &&
              item !== null &&
              typeof item.id === "string" &&
              item.file instanceof Blob,
          );
          setFiles(
            restored.map(({ id, file }) => ({
              id,
              file:
                file instanceof File
                  ? file
                  : new File([file], file.name ?? "bill.jpg", {
                      type: file.type,
                    }),
            })),
          );
        }
        setDraftNotice(
          t(
            changed
              ? "এই হিসাব অন্য জায়গায় বদলেছে। আপনার অসমাপ্ত লেখা রাখা আছে।"
              : "আগের অসমাপ্ত হিসাবটি ফিরিয়ে আনা হয়েছে।",
          ),
        );
      })
      .catch(() => {
        if (active) setDraftNotice(t("আগের অসমাপ্ত হিসাবটি খোলা যায়নি।"));
      })
      .finally(() => {
        if (active && read) {
          hydrated.current = true;
          setReady(true);
        }
      });
    return () => {
      active = false;
      mounted.current = false;
      if (hydrated.current && !finished.current)
        void queueDraft(latest.current).catch(() => {});
    };
  }, [draftKey, mode, storage, queueDraft]);

  useEffect(() => {
    if (!ready || saving || finished.current) return;
    const timer = window.setTimeout(() => {
      void queueDraft({ draft, files }).catch(() =>
        setDraftNotice(
          t("অসমাপ্ত হিসাবটি রাখা যায়নি। বন্ধ করার আগে সংরক্ষণ করুন।"),
        ),
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, files, ready, saving, queueDraft, t]);

  function field<K extends keyof Draft>(key: K, value: Draft[K]) {
    setError("");
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function rowField<K extends keyof DraftRow>(
    index: number,
    key: K,
    value: DraftRow[K],
  ) {
    setError("");
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row, position) =>
        position === index ? { ...row, [key]: value } : row,
      ),
    }));
  }

  function chooseWork(workId: string) {
    setDraft((current) => ({
      ...current,
      workId,
      contractId: "",
      rows: current.rows.map((row) =>
        row.workId === current.workId || !row.workId ? { ...row, workId } : row,
      ),
    }));
  }

  function chooseKind(kind: FormKind) {
    if (original) return;
    setError("");
    setDraft((current) => ({
      ...current,
      kind,
      account: kind === "labour" ? "labour" : "materials",
      contractId: "",
      relatedEntryId: "",
      workerPaid: false,
      paidNow: kind === "purchase",
      split: false,
      amount: "",
      paidAmount: "",
      rows: [newRow(current.workId, kind === "labour" ? "labour" : "material")],
      methods: [{ method: "cash", amount: "" }],
    }));
  }

  function paymentParts(total: number) {
    if (draft.methods.length === 1)
      return [{ method: draft.methods[0].method, amount: total }];
    const parts = draft.methods.map((part) => ({
      method: part.method,
      amount: poisha(part.amount),
    }));
    if (
      parts.some(
        (part) => !Number.isSafeInteger(part.amount) || part.amount <= 0,
      ) ||
      parts.reduce((sum, part) => sum + part.amount, 0) !== total
    )
      throw new Error(
        t("কোন মাধ্যমে কত দিয়েছেন, তার যোগফল মোট টাকার সমান হতে হবে।"),
      );
    return parts;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || !ready || processingFiles) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const now = new Date().toISOString();
      let next = structuredClone(ledger);
      if (
        ledger.works.some(
          (work) =>
            work.archivedAt &&
            (work.id === draft.workId ||
              draft.rows.some((row) => row.workId === work.id)) &&
            !original?.lines.some((line) => line.workId === work.id) &&
            !original?.allocations.some(
              (allocation) => allocation.workId === work.id,
            ),
        ) ||
        ledger.people.some(
          (person) =>
            person.archivedAt &&
            person.id === draft.personId &&
            person.id !== original?.personId,
        ) ||
        ledger.contracts.some(
          (job) =>
            job.archivedAt &&
            job.id === draft.contractId &&
            job.id !== original?.contractId,
        )
      )
        throw new Error(t("মুছে রাখা নাম, খাতা বা কাজ আগে ফিরিয়ে আনুন।"));
      if (editEntryId && (!original || original.id !== draft.id))
        throw new Error(
          t("যে হিসাবটি বদলাতে চেয়েছেন, সেটি খুঁজে পাওয়া যায়নি।"),
        );
      if (original && original.updatedAt !== draft.entryUpdatedAt)
        throw new Error(
          t(
            "এই হিসাব এর মধ্যে বদলেছে। বন্ধ করে আবার খুলুন। আপনার অসমাপ্ত লেখা রাখা আছে।",
          ),
        );
      if (
        !original &&
        next.entries.some(
          (entry) => entry.id === draft.id || entry.id === draft.paymentId,
        )
      )
        throw new Error(
          t("এই হিসাবটি আগেই রাখা হয়েছে। বন্ধ করে নতুন হিসাব খুলুন।"),
        );
      const personId =
        draft.personId === "__new__"
          ? draft.newPersonId || crypto.randomUUID()
          : draft.personId || null;
      if (draft.personId === "__new__") {
        if (!draft.newPersonName.trim())
          throw new Error(t("ব্যক্তি বা দোকানের নাম লিখুন।"));
        if (!next.people.some((person) => person.id === personId))
          next.people.push(
            PersonSchema.parse({
              id: personId!,
              name: draft.newPersonName.trim(),
              role: "",
              phone: "",
            }),
          );
      }
      if (!draft.workId || !next.works.some((work) => work.id === draft.workId))
        throw new Error(t("কোন কাজের হিসাব, তা বেছে নিন।"));
      if (!draft.unknownDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date))
        throw new Error(t("সঠিক তারিখ দিন।"));
      const relatedBill = next.entries.find(
        (entry) =>
          entry.id === draft.relatedEntryId && entry.kind === "expense",
      );
      if (
        (isCash || draft.workerPaid || isLabour || draft.kind === "return") &&
        !personId &&
        !relatedBill
      )
        throw new Error(
          t(
            "কার সঙ্গে হিসাব, তার নাম বেছে নিন। নাম ছাড়া হলে আগের বিলটি বেছে নিন।",
          ),
        );
      const account = isLabour ? "labour" : draft.account;
      const selectedPerson = next.people.find((p) => p.id === personId);
      if (
        selectedPerson &&
        (!original ||
          original.personId !== personId ||
          original.account !== account) &&
        !canAssignContact(
          selectedPerson,
          account,
          draft.rows.map((row) => (isLabour ? "labour" : row.costType)),
          isCash,
        )
      )
        throw new Error(
          t("মালের জন্য দোকান আর মজুরির জন্য মিস্ত্রির নাম বেছে নিন।"),
        );

      const contractId =
        account === "labour" ? selectedContractId || null : null;
      const receipts = [
        ...(original?.receipts ?? []),
        ...files.map(({ id, file }) => ({
          id,
          name: file.name,
          mime: file.type,
          size: file.size,
        })),
      ];
      const base = {
        paymentPurposeId:
          original?.account === account && isCash
            ? original.paymentPurposeId
            : null,
        balanceImpact: original?.balanceImpact ?? "normal",
        reviewStatus: original?.reviewStatus ?? "confirmed",
        reviewReason: original?.reviewReason ?? "",
        source: original?.source ?? null,
        provenance: original?.provenance,
        id: draft.id,
        date: draft.unknownDate ? null : draft.date,
        note: draft.note.trim(),
        personId,
        account,
        contractId,
        relatedEntryId: draft.relatedEntryId || null,
        receipts,
        createdAt: original ? original.createdAt : now,
        updatedAt: now,
        voided: original?.voided ?? false,
        revisions: original?.revisions ?? [],
      };
      let entry: Entry;
      let autoPayment: Entry | null = null;
      if (isCash) {
        const allocations = draft.split
          ? draft.rows.map((row) => ({
              workId: row.workId,
              amount: poisha(row.amount),
            }))
          : [{ workId: draft.workId, amount: poisha(draft.amount) }];
        if (
          allocations.some(
            (allocation) =>
              !Number.isSafeInteger(allocation.amount) ||
              allocation.amount <= 0 ||
              !next.works.some((work) => work.id === allocation.workId),
          )
        )
          throw new Error(t("প্রতিটি কাজের জন্য সঠিক টাকার পরিমাণ দিন।"));
        const total = allocations.reduce(
          (sum, allocation) => sum + allocation.amount,
          0,
        );
        entry = {
          ...base,
          kind: draft.kind === "refund" ? "refund" : "payment",
          lines: [],
          allocations,
          paymentParts: paymentParts(total),
        };
      } else {
        const lines = draft.rows.map((row) => {
          const amount = poisha(row.amount);
          if (!Number.isSafeInteger(amount) || amount <= 0)
            throw new Error(t("প্রতিটি খরচের জন্য সঠিক টাকার পরিমাণ দিন।"));
          if (!next.works.some((work) => work.id === row.workId))
            throw new Error(t("প্রতিটি খরচ কোন কাজের, তা বেছে নিন।"));
          const label =
            row.name.trim() ||
            (row.costType === "material" ? "" : t(costNames[row.costType]));
          if (!label) throw new Error(t("মালামালের নাম লিখুন।"));
          let itemId = row.itemId || null;
          if (row.costType === "material") {
            const namedMatches = next.items.filter(
              (candidate) =>
                candidate.name.toLocaleLowerCase() ===
                  label.toLocaleLowerCase() ||
                candidate.aliases.some(
                  (alias) =>
                    alias.toLocaleLowerCase() === label.toLocaleLowerCase(),
                ),
            );
            const item =
              next.items.find((candidate) => candidate.id === row.itemId) ??
              (namedMatches.length === 1 ? namedMatches[0] : undefined);
            if (item) itemId = item.id;
            else {
              itemId = row.itemId || crypto.randomUUID();
              if (!next.items.some((candidate) => candidate.id === itemId))
                next.items.push(
                  ItemSchema.parse({
                    id: itemId,
                    name: label,
                    unit: row.unit.trim(),
                    aliases: [],
                  }),
                );
            }
          } else itemId = null;
          return {
            materialGroupId:
              original?.lines.find((line) => line.id === row.id)
                ?.materialGroupId ?? null,
            usage:
              original?.lines.find((line) => line.id === row.id)?.usage ?? "",
            id: row.id,
            workId: row.workId,
            itemId,
            label,
            costType: isLabour ? ("labour" as const) : row.costType,
            amount,
            quantity: latinDigits(row.quantity.trim()),
            unit: row.unit.trim(),
          };
        });
        const total = lines.reduce((sum, line) => sum + line.amount, 0);
        entry = {
          ...base,
          kind: draft.kind === "return" ? "expense_credit" : "expense",
          lines,
          allocations: [],
          paymentParts: [],
        };
        if (original && hasLinkedPayments) {
          const before = [...new Set(original.lines.map((line) => line.workId))]
            .sort()
            .join("|");
          const after = [...new Set(lines.map((line) => line.workId))]
            .sort()
            .join("|");
          if (
            original.personId !== personId ||
            original.account !== account ||
            original.contractId !== contractId ||
            before !== after
          )
            throw new Error(
              t(
                "এই বিলের সঙ্গে টাকা দেওয়ার হিসাব আছে। কাজ, ব্যক্তি বা চুক্তি বদলাতে আগে যুক্ত হিসাবটি দেখুন। দাম ও বিবরণ বদলানো যাবে।",
              ),
            );
        }
        if (!original && draft.paidNow && draft.kind !== "return") {
          const paid = poisha(
            draft.paidAmount.trim() || moneyInputValue(total),
          );
          if (!Number.isSafeInteger(paid) || paid <= 0)
            throw new Error(t("এখন কত টাকা দিয়েছেন, তা সঠিকভাবে লিখুন।"));
          if (paid !== total && !personId)
            throw new Error(
              t("বাকি বা বাড়তি টাকা রাখতে ব্যক্তি বা দোকানের নাম দিন।"),
            );
          const byWork = new Map<string, number>();
          for (const line of lines)
            byWork.set(
              line.workId,
              (byWork.get(line.workId) ?? 0) + line.amount,
            );
          const amounts = [...byWork.entries()];
          let allocated = 0;
          const allocations = amounts
            .map(([workId, amount], index) => {
              const value =
                index === amounts.length - 1
                  ? paid - allocated
                  : Number((BigInt(paid) * BigInt(amount)) / BigInt(total));
              allocated += value;
              return { workId, amount: value };
            })
            .filter((allocation) => allocation.amount > 0);
          autoPayment = {
            ...base,
            id: draft.paymentId,
            relatedEntryId: entry.id,
            kind: "payment",
            receipts: [],
            revisions: [],
            note: draft.note.trim() || t("কেনাকাটার সঙ্গে টাকা দেওয়া"),
            lines: [],
            allocations,
            paymentParts: paymentParts(paid),
          };
        } else if (
          !original &&
          !draft.paidNow &&
          draft.kind !== "return" &&
          !personId
        )
          throw new Error(t("কার কাছে বাকি থাকবে, তার নাম দিন।"));
      }
      if (original) next = replaceEntry(next, entry);
      else
        next.entries = [
          ...next.entries.filter(
            (existing) =>
              existing.id !== entry.id && existing.id !== autoPayment?.id,
          ),
          entry,
          ...(autoPayment ? [autoPayment] : []),
        ];
      const checked = LedgerSchema.safeParse(next);
      if (!checked.success)
        throw new Error(
          t("হিসাবটি মিলছে না। কাজ, ব্যক্তি ও টাকার পরিমাণ আবার দেখুন।"),
        );
      next = checked.data;
      await queueDraft(latest.current);
      await onSave(
        next,
        files.length ? { entryId: entry.id, files } : undefined,
      );
      finished.current = true;
      await queue.current.catch(() => {});
      try {
        await storage.removeDraft(draftKey);
      } catch {
        /* the saved entry keeps its stable id if a draft remains */
      }
      if (mounted.current) onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        /[\u0980-\u09ff]/.test(message)
          ? message
          : t(
              "হিসাবটি রাখা যায়নি। তথ্য ও ফোনের খালি জায়গা দেখে আবার চেষ্টা করুন।",
            ),
      );
      lock.current = false;
      setSaving(false);
    }
  }

  async function addFiles(selected: FileList | null) {
    if (!selected) return;
    const incoming = Array.from(selected);
    if (
      files.length + (original?.receipts.length ?? 0) + incoming.length >
      20
    ) {
      setError(
        t("একটি হিসাবে সর্বোচ্চ {{limit}}টি ছবি বা ভাউচার রাখুন।", {
          limit: number(20),
        }),
      );
      return;
    }
    if (
      incoming.some(
        (file) =>
          file.size >
            (file.type === "application/pdf" ? 10 : 25) * 1024 * 1024 ||
          ![
            "image/jpeg",
            "image/png",
            "image/webp",
            "application/pdf",
          ].includes(file.type),
      )
    ) {
      setError(
        t(
          "JPG, PNG, WebP ছবি বা PDF দিন। PDF {{pdfLimit}} MB ও ছবি {{imageLimit}} MB-এর মধ্যে হতে হবে।",
          { pdfLimit: number(10), imageLimit: number(25) },
        ),
      );
      return;
    }
    setProcessingFiles(true);
    try {
      const compacted = await Promise.all(incoming.map(compactPhoto));
      if (compacted.some((file) => file.size > 10 * 1024 * 1024))
        throw new Error(t("ছবিটি অনেক বড়। ছোট ছবি দিয়ে আবার চেষ্টা করুন।"));
      setFiles((current) => [
        ...current,
        ...compacted.map((file) => ({ id: crypto.randomUUID(), file })),
      ]);
      setError("");
    } catch {
      setError(t("ছবিটি পড়া যায়নি। অন্য ছবি দিয়ে চেষ্টা করুন।"));
    } finally {
      setProcessingFiles(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const useSavedChanges = () => {
    if (!original || draftConflict !== "changed") return;
    if (draft.id !== original.id || draft.kind !== editDraft(original).kind) {
      setDraftConflict("mismatch");
      setDraftNotice(
        t("অসমাপ্ত লেখাটি এই হিসাবের সঙ্গে মিলছে না। আগের লেখা রাখা আছে।"),
      );
      return;
    }
    const rebased = { ...draft, entryUpdatedAt: original.updatedAt };
    latest.current = { draft: rebased, files };
    setDraft(rebased);
    setDraftConflict(null);
    setDraftNotice(t("আপনার লেখা ব্যবহার হচ্ছে। মিলিয়ে নিয়ে রাখুন।"));
    hydrated.current = true;
    setReady(true);
  };

  const close = () => {
    if (lock.current || processingFiles) return;
    if (!ready) {
      onClose();
      return;
    }
    lock.current = true;
    setSaving(true);
    void queueDraft(latest.current)
      .then(() => {
        finished.current = true;
        if (mounted.current) onClose();
      })
      .catch(() => {
        setError(
          t(
            "অসমাপ্ত হিসাবটি রাখা যায়নি। আগে সংরক্ষণ করুন বা আবার চেষ্টা করুন।",
          ),
        );
        lock.current = false;
        setSaving(false);
      });
  };
  const discard = () => {
    if (lock.current || processingFiles) return;
    lock.current = true;
    finished.current = true;
    setSaving(true);
    void queue.current
      .catch(() => {})
      .then(() => storage.removeDraft(draftKey))
      .then(() => {
        finished.current = true;
        if (mounted.current) onClose();
      })
      .catch(() => {
        setError(t("অসমাপ্ত লেখা বাদ দেওয়া যায়নি। আবার চেষ্টা করুন।"));
        finished.current = false;
        lock.current = false;
        setSaving(false);
      });
  };
  const availableWorks = ledger.works.filter(
    (work) =>
      !work.archivedAt ||
      (Boolean(original) &&
        (original?.lines.some((line) => line.workId === work.id) ||
          original?.allocations.some(
            (allocation) => allocation.workId === work.id,
          ))),
  );
  const workOptions = availableWorks.map((work) => (
    <option key={work.id} value={work.id}>
      {work.name}
    </option>
  ));
  const methodNames = {
    cash: "নগদ",
    bkash: "বিকাশ",
    bank: "ব্যাংক",
    other: "অন্য মাধ্যমে",
  };

  const Frame = presentation === "page" ? EntryFrame : Sheet;
  return (
    <Frame
      title={t(original ? "হিসাব বদলান" : "নতুন হিসাব")}
      subtitle={t("ছোট ছোট হিসাব, এক জায়গায়।")}
      onClose={close}
      footer={
        <button
          type="submit"
          form="entry-form"
          className="primary-button full-width"
          disabled={
            saving || processingFiles || !ready || !availableWorks.length
          }
        >
          {saving
            ? t("সংরক্ষণ হচ্ছে…")
            : processingFiles
              ? t("ছবি ছোট করা হচ্ছে…")
              : t("সংরক্ষণ করুন")}
        </button>
      }
    >
      <form
        id="entry-form"
        className="sheet-form"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <FormError {...errorNotice} className="error-message" />
        {draftNotice ? (
          <div
            className="muted form-hint"
            role={draftConflict ? "alert" : "status"}
          >
            <p>{draftNotice}</p>
            {draftConflict === "changed" ? (
              <button
                type="button"
                className="secondary-button"
                onClick={useSavedChanges}
              >
                {t("আমার লেখা ব্যবহার করি")}
              </button>
            ) : null}
          </div>
        ) : null}
        {!availableWorks.length ? (
          <p className="error-message">{t("প্রথমে একটি কাজ যোগ করুন")}</p>
        ) : null}
        {!original ? (
          <fieldset
            className="entry-kind-grid"
            disabled={saving || !ready || Boolean(original)}
            aria-label={t("কী হিসাব লিখবেন")}
          >
            {(
              [
                "purchase",
                "labour",
                "payment",
                "return",
                "refund",
              ] as FormKind[]
            ).map((kind) => (
              <button
                key={kind}
                type="button"
                className={`kind-button ${draft.kind === kind ? "active" : ""}`}
                aria-pressed={draft.kind === kind}
                onClick={() => chooseKind(kind)}
              >
                {kind === "purchase" ? (
                  <Receipt size={17} />
                ) : kind === "labour" ? (
                  <Wrench size={17} />
                ) : (
                  <Wallet size={17} />
                )}
                {t(kindNames[kind])}
              </button>
            ))}
          </fieldset>
        ) : null}
        <fieldset
          className="sheet-fields"
          disabled={saving || processingFiles || !ready}
        >
          <div className="form-grid">
            <label className="field">
              <span className="field-label">{t("কোন কাজের হিসাব")}</span>
              <AppSelect
                className="field-input"
                value={draft.workId}
                onChange={(event) => chooseWork(event.target.value)}
                required
              >
                <option value="">{t("কাজ বেছে নিন")}</option>
                {workOptions}
              </AppSelect>
            </label>
            <label className="field">
              <span className="field-label">{t("তারিখ")}</span>
              <AppDatePicker
                className="field-input"
                type="date"
                value={draft.date}
                disabled={draft.unknownDate}
                onChange={(event) => field("date", event.target.value)}
                required={!draft.unknownDate}
              />
            </label>
          </div>
          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.unknownDate}
              onChange={(event) => field("unknownDate", event.target.checked)}
            />
            {t("তারিখ জানা নেই")}
          </label>
          <label className="field">
            <span className="field-label">
              {t(
                isCash
                  ? draft.kind === "refund"
                    ? "কার কাছ থেকে পেয়েছেন"
                    : "কাকে টাকা দিয়েছেন"
                  : draft.workerPaid
                    ? "কোন মিস্ত্রি নিজের টাকা খরচ করেছেন"
                    : "কার সঙ্গে হিসাব",
              )}
            </span>
            <AppSelect
              className="field-input"
              value={draft.personId}
              onChange={(event) => {
                field("personId", event.target.value);
                field("contractId", "");
              }}
            >
              <option value="">{t("নাম ছাড়া রাখব")}</option>
              {ledger.people
                .filter(
                  (person) =>
                    !person.archivedAt ||
                    (Boolean(original) && person.id === original?.personId),
                )
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                    {person.role ? ` · ${person.role}` : ""}
                  </option>
                ))}
              <option value="__new__">{t("নতুন নাম লিখব")}</option>
            </AppSelect>
          </label>
          {draft.personId === "__new__" ? (
            <label className="field">
              <span className="field-label">{t("ব্যক্তি বা দোকানের নাম")}</span>
              <input
                className="field-input"
                value={draft.newPersonName}
                maxLength={200}
                onChange={(event) => field("newPersonName", event.target.value)}
                placeholder={t("নাম লিখুন")}
                required
              />
            </label>
          ) : null}
          {isCash ? (
            <label className="field">
              <span className="field-label">{t("কী বাবদ টাকা")}</span>
              <AppSelect
                className="field-input"
                value={draft.account}
                onChange={(event) => {
                  field("account", event.target.value as Draft["account"]);
                  field("contractId", "");
                }}
              >
                <option value="materials">{t("মালামালের টাকা")}</option>
                <option value="labour">{t("মজুরির টাকা")}</option>
                <option value="other">{t("অন্য টাকা")}</option>
              </AppSelect>
            </label>
          ) : null}
          {draft.kind === "return" || draft.kind === "refund" ? (
            <label className="field">
              <span className="field-label">{t("আগের কোন বিলের হিসাব")}</span>
              <AppSelect
                className="field-input"
                value={draft.relatedEntryId}
                onChange={(event) => {
                  const bill = ledger.entries.find(
                    (entry) => entry.id === event.target.value,
                  );
                  field("relatedEntryId", event.target.value);
                  if (bill) {
                    field("personId", bill.personId ?? "");
                    field("account", bill.account);
                    field("contractId", bill.contractId ?? "__none__");
                    const workId = bill.lines[0]?.workId ?? draft.workId;
                    field("workId", workId);
                    field("split", false);
                    field("rows", [
                      {
                        ...newRow(
                          workId,
                          bill.account === "labour" ? "labour" : "material",
                        ),
                        itemId: bill.lines[0]?.itemId ?? "",
                        name: bill.lines[0]?.label ?? "",
                      },
                    ]);
                  }
                }}
              >
                <option value="">
                  {t("বিল বেছে নিন বা নামের খাতায় রাখুন")}
                </option>
                {relatedBills.map((bill) => (
                  <option key={bill.id} value={bill.id}>
                    {bill.lines[0]?.label || bill.note || t("কেনাকাটার বিল")} ·{" "}
                    {money(
                      bill.lines.reduce((sum, line) => sum + line.amount, 0),
                    )}
                  </option>
                ))}
              </AppSelect>
              <span className="form-hint muted">
                {t(
                  "শুধু ফেরত দেওয়া অংশের দাম লিখুন। টাকা হাতে পেলে তার হিসাব আলাদা হবে।",
                )}
              </span>
            </label>
          ) : null}
          {(isLabour || draft.account === "labour") &&
          eligibleContracts.length ? (
            <label className="field">
              <span className="field-label">{t("কোন চুক্তির হিসাব")}</span>
              <AppSelect
                className="field-input"
                value={selectedContractId || "__none__"}
                onChange={(event) => {
                  field("contractId", event.target.value);
                  if (event.target.value !== "__none__") {
                    field("split", false);
                    field(
                      "rows",
                      draft.rows.map((row) => ({
                        ...row,
                        workId: draft.workId,
                      })),
                    );
                  }
                }}
              >
                <option value="__none__">{t("চুক্তি ছাড়া রাখব")}</option>
                {eligibleContracts.map((contract) => (
                  <option key={contract.id} value={contract.id}>
                    {contract.title || t("মজুরির চুক্তি")}
                  </option>
                ))}
              </AppSelect>
            </label>
          ) : null}
          {isCash ? (
            <>
              {!draft.split ? (
                <label className="field">
                  <span className="field-label">{t("টাকার পরিমাণ")}</span>
                  <div className="money-input">
                    <span aria-hidden="true">৳</span>
                    <MoneyInput
                      className="field-input amount-input"
                      inputMode="decimal"
                      value={draft.amount}
                      onChange={(event) => field("amount", event.target.value)}
                      placeholder="0"
                      required
                    />
                  </div>
                </label>
              ) : (
                <div className="cost-lines">
                  {draft.rows.map((row, index) => (
                    <div className="cost-line" key={row.id}>
                      <div className="form-grid">
                        <label className="field">
                          <span className="field-label">{t("কাজ")}</span>
                          <AppSelect
                            className="field-input"
                            value={row.workId}
                            onChange={(event) =>
                              rowField(index, "workId", event.target.value)
                            }
                            required
                          >
                            {workOptions}
                          </AppSelect>
                        </label>
                        <label className="field">
                          <span className="field-label">{t("টাকা")}</span>
                          <MoneyInput
                            className="field-input"
                            inputMode="decimal"
                            value={row.amount}
                            onChange={(event) =>
                              rowField(index, "amount", event.target.value)
                            }
                            required
                          />
                        </label>
                      </div>
                      {draft.rows.length > 1 ? (
                        <button
                          type="button"
                          className="text-button danger-text"
                          onClick={() =>
                            field(
                              "rows",
                              draft.rows.filter(
                                (_, position) => index !== position,
                              ),
                            )
                          }
                        >
                          <Trash2 size={14} />
                          {t("এই ভাগ সরান")}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      field("rows", [...draft.rows, newRow(draft.workId)])
                    }
                  >
                    <Plus size={16} />
                    {t("আরেক কাজে ভাগ করুন")}
                  </button>
                </div>
              )}
              {!(draft.account === "labour" && selectedContractId) ? (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={draft.split}
                    onChange={(event) => {
                      field("split", event.target.checked);
                      if (event.target.checked)
                        field("rows", [
                          { ...newRow(draft.workId), amount: draft.amount },
                        ]);
                      else field("amount", moneyInputValue(lineTotal));
                    }}
                  />
                  {t("একাধিক কাজে ভাগ করব")}
                </label>
              ) : null}
              <p className="form-hint muted">
                {t(
                  draft.kind === "refund"
                    ? "এটি শুধু টাকা ফেরত পাওয়ার হিসাব। মাল ফেরত দিলে তার হিসাব আলাদা লিখুন।"
                    : "আগের বাকি মেটালে নতুন খরচ বাড়বে না। বাড়তি টাকা দিলে তা তার কাছে জমা থাকবে।",
                )}
              </p>
            </>
          ) : (
            <>
              <div className="cost-lines">
                {draft.rows.map((row, index) => (
                  <div className="cost-line" key={row.id}>
                    <div className="line-top">
                      <span className="field-label">
                        {t("খরচ {{index}}", { index: index + 1 })}
                      </span>
                      {draft.rows.length > 1 ? (
                        <button
                          type="button"
                          className="icon-button danger-text"
                          aria-label={t("এই খরচ সরান")}
                          onClick={() =>
                            field(
                              "rows",
                              draft.rows.filter(
                                (_, position) => index !== position,
                              ),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      ) : null}
                    </div>
                    {!isLabour ? (
                      <label className="field">
                        <span className="field-label">{t("খরচের ধরন")}</span>
                        <AppSelect
                          className="field-input"
                          value={row.costType}
                          onChange={(event) =>
                            rowField(
                              index,
                              "costType",
                              event.target.value as DraftRow["costType"],
                            )
                          }
                        >
                          {costTypes
                            .filter((type) => type !== "labour")
                            .map((type) => (
                              <option key={type} value={type}>
                                {t(costNames[type])}
                              </option>
                            ))}
                        </AppSelect>
                      </label>
                    ) : null}
                    <label className="field">
                      <span className="field-label">
                        {t(isLabour ? "কাজের বিবরণ" : "মালামাল বা খরচের নাম")}
                      </span>
                      <AppCombobox
                        className="field-input"
                        suggestions={ledger.items.map((item) => ({
                          value: item.name,
                          description: item.brand,
                        }))}
                        value={row.name}
                        maxLength={300}
                        onChange={(event) => {
                          rowField(index, "name", event.target.value);
                          rowField(index, "itemId", "");
                        }}
                        placeholder={t(
                          isLabour
                            ? "যেমন: প্লাস্টারের কাজ"
                            : row.costType === "material"
                              ? "যেমন: টাইলসের আঠা"
                              : costNames[row.costType],
                        )}
                        required={!isLabour && row.costType === "material"}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">{t("মোট দাম")}</span>
                      <div className="money-input">
                        <span aria-hidden="true">৳</span>
                        <MoneyInput
                          className="field-input"
                          inputMode="decimal"
                          value={row.amount}
                          onChange={(event) =>
                            rowField(index, "amount", event.target.value)
                          }
                          placeholder="0"
                          required
                        />
                      </div>
                    </label>
                    <details className="line-details">
                      <summary>
                        {t("পরিমাণ বা অন্য কাজের ভাগ যোগ করুন")}
                      </summary>
                      <div className="form-grid">
                        <label className="field">
                          <span className="field-label">{t("পরিমাণ")}</span>
                          <NumericInput
                            className="field-input"
                            inputMode="decimal"
                            value={row.quantity}
                            maxLength={60}
                            onChange={(event) =>
                              rowField(index, "quantity", event.target.value)
                            }
                            placeholder={t("ইচ্ছা হলে লিখুন")}
                          />
                        </label>
                        <label className="field">
                          <span className="field-label">{t("একক")}</span>
                          <input
                            className="field-input"
                            value={row.unit}
                            maxLength={60}
                            onChange={(event) =>
                              rowField(index, "unit", event.target.value)
                            }
                            placeholder={t("বস্তা, পিস, কেজি…")}
                          />
                        </label>
                      </div>
                      {!(isLabour && selectedContractId) ? (
                        <label className="field">
                          <span className="field-label">
                            {t("কোন কাজে লাগবে")}
                          </span>
                          <AppSelect
                            className="field-input"
                            value={row.workId}
                            onChange={(event) =>
                              rowField(index, "workId", event.target.value)
                            }
                          >
                            {workOptions}
                          </AppSelect>
                        </label>
                      ) : null}
                    </details>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="secondary-button full-width"
                onClick={() =>
                  field("rows", [
                    ...draft.rows,
                    newRow(draft.workId, isLabour ? "labour" : "material"),
                  ])
                }
              >
                <Plus size={17} />
                {t(isLabour ? "আরেকটি কাজের হিসাব" : "আরেকটি মাল বা খরচ")}
              </button>
              <div className="entry-total">
                <span>
                  {t(
                    draft.kind === "return"
                      ? "ফেরত দেওয়া মালের মূল্য"
                      : "মোট হিসাব",
                  )}
                </span>
                <strong>{money(lineTotal)}</strong>
              </div>
              {draft.kind === "purchase" && !original ? (
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={draft.workerPaid}
                    onChange={(event) => {
                      field("workerPaid", event.target.checked);
                      field("paidNow", !event.target.checked);
                    }}
                  />
                  {t("মিস্ত্রি নিজের টাকা দিয়ে কিনেছেন")}
                </label>
              ) : null}
              {draft.workerPaid ? (
                <p className="form-hint muted">
                  {t(
                    "এই খরচ তার নামে জমা হবে। ফেরত দেওয়া টাকা আলাদা হিসাবে থাকবে।",
                  )}
                </p>
              ) : null}
              {!original && draft.kind !== "return" ? (
                <>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={draft.paidNow}
                      onChange={(event) =>
                        field("paidNow", event.target.checked)
                      }
                    />
                    {t(
                      draft.workerPaid
                        ? "এখন তার টাকা ফেরত দিয়েছি"
                        : "এই হিসাবের সঙ্গে টাকা দিয়েছি",
                    )}
                  </label>
                  {draft.paidNow ? (
                    <label className="field">
                      <span className="field-label">
                        {t("এখন কত টাকা দিয়েছেন")}
                      </span>
                      <div className="money-input">
                        <span aria-hidden="true">৳</span>
                        <MoneyInput
                          className="field-input"
                          inputMode="decimal"
                          value={draft.paidAmount}
                          onChange={(event) =>
                            field("paidAmount", event.target.value)
                          }
                          placeholder={moneyInputValue(lineTotal)}
                        />
                      </div>
                    </label>
                  ) : null}
                  {draft.paidNow &&
                  personIdForHint(draft) &&
                  cashTotal > lineTotal ? (
                    <p className="credit-hint">
                      {t("বাড়তি {{amount}} তার কাছে জমা থাকবে।", {
                        amount: money(cashTotal - lineTotal),
                      })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="form-hint muted">
                  {t(
                    original
                      ? "টাকা দেওয়া বা ফেরত পাওয়ার হিসাব আলাদা করে বদলান।"
                      : "এতে শুধু খরচ কমবে। ফেরত পাওয়া টাকা আলাদা হিসাবে লিখুন।",
                  )}
                </p>
              )}
            </>
          )}
          {isCash || (!original && draft.paidNow && draft.kind !== "return") ? (
            <div className="payment-methods">
              <span className="field-label">
                {t(
                  draft.kind === "refund"
                    ? "কোন মাধ্যমে পেয়েছেন"
                    : "কোন মাধ্যমে দিয়েছেন",
                )}
              </span>
              {draft.methods.map((part, index) => (
                <div className="method-row" key={index}>
                  <AppSelect
                    className="field-input"
                    aria-label={t("টাকা দেওয়ার মাধ্যম")}
                    value={part.method}
                    onChange={(event) =>
                      field(
                        "methods",
                        draft.methods.map((item, position) =>
                          position === index
                            ? {
                                ...item,
                                method: event.target
                                  .value as typeof part.method,
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {Object.entries(methodNames).map(([value, name]) => (
                      <option key={value} value={value}>
                        {t(name)}
                      </option>
                    ))}
                  </AppSelect>
                  {draft.methods.length > 1 ? (
                    <>
                      <MoneyInput
                        className="field-input"
                        aria-label={t("এই মাধ্যমে কত টাকা")}
                        inputMode="decimal"
                        value={part.amount}
                        onChange={(event) =>
                          field(
                            "methods",
                            draft.methods.map((item, position) =>
                              position === index
                                ? { ...item, amount: event.target.value }
                                : item,
                            ),
                          )
                        }
                        required
                      />
                      <button
                        type="button"
                        className="icon-button danger-text"
                        aria-label={t("এই মাধ্যম সরান")}
                        onClick={() =>
                          field(
                            "methods",
                            draft.methods.filter(
                              (_, position) => position !== index,
                            ),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  ) : null}
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  field("methods", [
                    ...draft.methods.map((part) =>
                      draft.methods.length === 1
                        ? { ...part, amount: moneyInputValue(cashTotal) }
                        : part,
                    ),
                    { method: "bkash", amount: "" },
                  ])
                }
              >
                <Plus size={14} />
                {t("অন্য মাধ্যমেও দিয়েছি")}
              </button>
              {draft.methods.length > 1 ? (
                <p className="form-hint muted">
                  {t("সব মাধ্যম মিলিয়ে মোট {{amount}} হতে হবে।", {
                    amount: money(cashTotal),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
          <label className="field">
            <span className="field-label">{t("মনে রাখার কথা")}</span>
            <textarea
              className="field-input"
              rows={3}
              value={draft.note}
              maxLength={10000}
              onChange={(event) => field("note", event.target.value)}
              placeholder={t("কী বাবদ, কোথা থেকে বা অন্য কিছু…")}
            />
          </label>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            multiple
            hidden
            onChange={(event) => {
              void addFiles(event.target.files);
            }}
          />
          <button
            type="button"
            className="secondary-button full-width"
            onClick={() => fileInput.current?.click()}
          >
            <Camera size={17} />
            {t("ভাউচার বা ছবি যোগ করুন")}
          </button>
          {original?.receipts.length ? (
            <p className="form-hint muted">
              {t("আগের {{count}}টি ভাউচার রাখা আছে।", {
                count: original.receipts.length,
              })}
            </p>
          ) : null}
          {files.map(({ id, file }) => (
            <div className="attachment-row" key={id}>
              <Receipt size={17} />
              <span>{formatDigits(file.name)}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={t("ভাউচার সরান")}
                onClick={() =>
                  setFiles((current) =>
                    current.filter((item) => item.id !== id),
                  )
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-button danger-text"
            onClick={discard}
          >
            {t("অসমাপ্ত লেখা বাদ দিন")}
          </button>
        </fieldset>
      </form>
    </Frame>
  );
}

function personIdForHint(draft: Draft) {
  return draft.personId === "__new__"
    ? draft.newPersonName.trim()
    : draft.personId;
}

async function compactPhoto(file: File) {
  if (!file.type.startsWith("image/") || file.size < 180 * 1024) return file;
  const url = URL.createObjectURL(file);
  try {
    const photo = new Image();
    photo.src = url;
    await photo.decode();
    const scale = Math.min(
      1,
      1600 / Math.max(photo.naturalWidth, photo.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(photo, 0, 0, canvas.width, canvas.height);
    const compressed = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.84),
    );
    return compressed && compressed.size < file.size
      ? new File([compressed], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, {
          type: "image/jpeg",
          lastModified: file.lastModified,
        })
      : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

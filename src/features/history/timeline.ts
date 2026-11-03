import type { Ledger } from "../../domain/model";
import { entryAudit, snapshotTotal } from "./audit";
import { historyTitle } from "./history";
import { workChanges } from "../../domain/workActivity";
import { contractChanges } from "../../domain/contracts";

export type TimelineCategory = "money" | "notebooks" | "jobs" | "removed";
export type TimelineEvent = {
  id: string;
  at: string;
  category: TimelineCategory;
  title: string;
  subject: string;
  note: string;
  changes: string[];
  before?: number;
  amount?: number;
  statusChange?: { before: string; after: string };
  target: { kind: "entry" | "work" | "job" | "person"; id: string };
};
const entryFields: Record<string, string> = {
  lines: "খরচের বিবরণ",
  allocations: "কাজে টাকার ভাগ",
  paymentParts: "টাকা দেওয়ার মাধ্যম",
  note: "নোট",
  date: "লেনদেনের তারিখ",
  personId: "ব্যক্তি বা দোকান",
  account: "হিসাবের খাত",
  contractId: "কাজ",
  relatedEntryId: "যে বিলের টাকা",
  receipts: "ভাউচার",
};
const workFields: Record<string, string> = {
  name: "নাম",
  description: "বিবরণ",
  status: "অবস্থা",
  color: "রং",
  icon: "চিহ্ন",
  startedOn: "শুরুর তারিখ",
  completedOn: "শেষের তারিখ",
  quickActions: "পছন্দের বোতাম",
};
const jobFields: Record<string, string> = {
  total: "কাজের টাকা",
  rate: "দর",
  quantity: "পরিমাণ",
  basis: "হিসাবের ধরন",
  title: "নাম",
  status: "অবস্থা",
  workId: "কাজের খাতা",
  personId: "মিস্ত্রি",
  scope: "কাজের পরিধি",
  agreedOn: "চুক্তির তারিখ",
  calculatedTotal: "হিসাব করে পাওয়া টাকা",
};
const workStatuses = {
  planned: "শুরু হয়নি",
  ongoing: "কাজ চলছে",
  done: "কাজ শেষ",
} as const;
const jobStatuses = {
  planned: "শুরু হয়নি",
  ongoing: "চলছে",
  done: "শেষ",
} as const;

export function notebookTimeline(ledger: Ledger): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const entry of ledger.entries) {
    for (const event of entryAudit(entry)) {
      if (!event.at) continue;
      events.push({
        id: `entry:${event.id}`,
        at: event.at,
        category: "money",
        title:
          event.kind === "created"
            ? (
                {
                  expense: "খরচের হিসাব রেখেছি",
                  payment: "টাকা দেওয়ার হিসাব রেখেছি",
                  refund: "ফেরত টাকার হিসাব রেখেছি",
                  expense_credit: "মাল ফেরতের হিসাব রেখেছি",
                } as const
              )[event.after.kind]
            : event.kind === "voided"
              ? "হিসাব বাতিল করেছি"
              : event.kind === "restored"
                ? "বাতিল হিসাব ফিরিয়েছি"
                : "হিসাব বদলেছি",
        subject: historyTitle(ledger, { ...event.after, revisions: [] }),
        note: event.after.note,
        changes: [
          ...new Set(
            event.changes
              .map((change) => entryFields[change.field])
              .filter(Boolean),
          ),
        ],
        ...(event.before ? { before: snapshotTotal(event.before) } : {}),
        amount: snapshotTotal(event.after),
        target: { kind: "entry", id: entry.id },
      });
    }
  }
  for (const work of ledger.works) {
    for (const event of work.activity)
      events.push({
        id: `work:${work.id}:${event.id}`,
        at: event.at,
        category: "notebooks",
        title: event.before ? "খাতার তথ্য বদলেছি" : "খাতা খুলেছি",
        subject: event.after.name,
        note: event.after.description,
        changes: (event.before ? workChanges(event.before, event.after) : [])
          .map((field) => workFields[field])
          .filter(Boolean),
        ...(event.before && event.before.status !== event.after.status
          ? {
              statusChange: {
                before: workStatuses[event.before.status],
                after: workStatuses[event.after.status],
              },
            }
          : {}),
        target: { kind: "work", id: work.id },
      });
  }
  for (const job of ledger.contracts) {
    for (const event of job.activity)
      events.push({
        id: `job:${job.id}:${event.id}`,
        at: event.at,
        category: "jobs",
        title: event.before ? "কাজের তথ্য বদলেছি" : "মিস্ত্রির কাজ রেখেছি",
        subject:
          event.after.title ||
          ledger.people.find((person) => person.id === job.personId)?.name ||
          "কাজ",
        note: event.reason,
        changes: (event.before
          ? contractChanges(event.before, event.after)
          : []
        )
          .map((field) => jobFields[field])
          .filter(Boolean),
        ...(event.before && event.before.status !== event.after.status
          ? {
              statusChange: {
                before: event.before.status
                  ? jobStatuses[event.before.status]
                  : "অবস্থা লেখা নেই",
                after: event.after.status
                  ? jobStatuses[event.after.status]
                  : "অবস্থা লেখা নেই",
              },
            }
          : {}),
        ...(event.before ? { before: event.before.total } : {}),
        amount: event.after.total,
        target: { kind: "job", id: job.id },
      });
    for (const [index, event] of job.history.entries())
      events.push({
        id: `job-legacy:${job.id}:${index}`,
        at: event.at,
        category: "jobs",
        title: "আগের চুক্তির অঙ্ক রেখেছি",
        subject:
          job.title ||
          ledger.people.find((person) => person.id === job.personId)?.name ||
          "কাজ",
        note: event.note,
        changes: [],
        amount: event.total,
        target: { kind: "job", id: job.id },
      });
  }
  for (const [records, kind, removed, restored] of [
    [ledger.works, "work", "খাতা সরিয়েছি", "খাতা ফিরিয়েছি"],
    [ledger.people, "person", "নাম সরিয়েছি", "নাম ফিরিয়েছি"],
    [
      ledger.contracts,
      "job",
      "মিস্ত্রির কাজ সরিয়েছি",
      "মিস্ত্রির কাজ ফিরিয়েছি",
    ],
  ] as const) {
    for (const record of records)
      for (const event of record.removalHistory)
        events.push({
          id: `removal:${kind}:${record.id}:${event.id}`,
          at: event.at,
          category: "removed",
          title: event.archived ? removed : restored,
          subject: "name" in record ? record.name : record.title || "কাজ",
          note: "",
          changes: [],
          target: { kind, id: record.id },
        });
  }
  return events.sort(
    (a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id),
  );
}

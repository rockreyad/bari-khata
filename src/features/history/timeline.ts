import type { Ledger } from "../../domain/model";
import { entryAudit, snapshotTotal, type EntrySnapshot } from "./audit";
import { workChanges } from "../../domain/workActivity";
import { contractChanges } from "../../domain/contracts";
import { latinDigits } from "../../lib/numerals";
import { z } from "zod";
import { adjustmentBasisLabels } from "./adjustmentDisplay";

const RecordedTime = z.string().datetime({ offset: true });

export type TimelineCategory = "money" | "notebooks" | "jobs" | "removed";
type TimelineState =
  | "expense"
  | "paid"
  | "credit"
  | "refund"
  | "adjustment"
  | "voided"
  | "planned"
  | "ongoing"
  | "done"
  | "unknown";
export type TimelineEvent = {
  id: string;
  at: string;
  category: TimelineCategory;
  state?: TimelineState;
  title: string;
  subject: string;
  note: string;
  changes: string[];
  before?: number;
  amount?: number;
  statusChange?: { before: string; after: string };
  adjustmentChange?: {
    basis: keyof typeof adjustmentBasisLabels;
    before: number;
    after: number;
  };
  target: { kind: "entry" | "work" | "job" | "person"; id: string };
};
export type TimelineSearchRecord = { event: TimelineEvent; text: string };
export const timelinePageSize = 40;
export const normalizeTimelineSearch = (text: string) =>
  latinDigits(text)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function indexTimeline(
  events: TimelineEvent[],
  translate: (text: string) => string,
): TimelineSearchRecord[] {
  return events.map((event) => ({
    event,
    text: normalizeTimelineSearch(
      [
        translate(event.title),
        event.subject,
        event.note,
        ...event.changes.map((field) => translate(field)),
        ...(event.statusChange
          ? [
              translate(event.statusChange.before),
              translate(event.statusChange.after),
            ]
          : []),
      ].join(" "),
    ),
  }));
}

export function searchTimeline(
  index: TimelineSearchRecord[],
  query: string,
  category: TimelineCategory | "all" = "all",
) {
  const normalized = normalizeTimelineSearch(query);
  return index
    .filter(
      ({ event, text }) =>
        (category === "all" || event.category === category) &&
        (!normalized || text.includes(normalized)),
    )
    .map(({ event }) => event);
}

export function timelinePage(
  events: TimelineEvent[],
  requested: string | null,
) {
  const value =
    requested && /^[1-9]\d*$/.test(requested) ? Number(requested) : 1;
  const count = Math.max(1, Math.ceil(events.length / timelinePageSize));
  const page = Math.min(Number.isSafeInteger(value) ? value : 1, count);
  const offset = (page - 1) * timelinePageSize;
  return {
    page,
    count,
    from: events.length ? offset + 1 : 0,
    to: Math.min(offset + timelinePageSize, events.length),
    events: events.slice(offset, offset + timelinePageSize),
  };
}
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
  adjustment: "হিসাবের সমন্বয়",
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
  workId: "সেক্টর",
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
  const people = new Map(
    ledger.people.map((person) => [person.id, person.name]),
  );
  const purposes = new Map(
    ledger.paymentPurposes.map((purpose) => [purpose.id, purpose.name]),
  );
  const subject = (entry: EntrySnapshot) => {
    if (entry.kind === "adjustment")
      return (
        people.get(entry.personId ?? "") ||
        ledger.works.find((work) => work.id === entry.adjustment?.workId)
          ?.name ||
        "হিসাবের সমন্বয়"
      );
    if (entry.kind === "payment" || entry.kind === "refund")
      return (
        people.get(entry.personId ?? "") ||
        purposes.get(entry.paymentPurposeId ?? "") ||
        (entry.kind === "refund"
          ? "টাকা ফেরত পেয়েছি"
          : entry.account === "labour"
            ? "মজুরি দিয়েছি"
            : "টাকা দিয়েছি")
      );
    return (
      entry.lines[0]?.label ||
      entry.note ||
      (entry.account === "labour" ? "মজুরির হিসাব" : "খরচ")
    );
  };
  for (const entry of ledger.entries) {
    if (!entry.createdAt && !entry.revisions.length) continue;
    for (const event of entryAudit(entry)) {
      if (!event.at) continue;
      events.push({
        id: `entry:${event.id}`,
        at: event.at,
        category: "money",
        state: event.after.voided
          ? "voided"
          : (
              {
                expense: "expense",
                payment: "paid",
                expense_credit: "credit",
                refund: "refund",
                adjustment: "adjustment",
              } as const
            )[event.after.kind],
        title:
          event.kind === "created"
            ? (
                {
                  expense: "খরচের হিসাব রেখেছি",
                  payment: "টাকা দেওয়ার হিসাব রেখেছি",
                  refund: "ফেরত টাকার হিসাব রেখেছি",
                  expense_credit: "মাল ফেরতের হিসাব রেখেছি",
                  adjustment: "হিসাবের সমন্বয় রেখেছি",
                } as const
              )[event.after.kind]
            : event.kind === "voided"
              ? "হিসাব বাতিল করেছি"
              : event.kind === "restored"
                ? "বাতিল হিসাব ফিরিয়েছি"
                : "হিসাব বদলেছি",
        subject: subject(event.after),
        note: event.after.note,
        changes: [
          ...new Set(
            event.changes
              .map((change) => entryFields[change.field])
              .filter(Boolean),
          ),
        ],
        ...(event.after.kind === "adjustment" && event.after.adjustment
          ? {
              adjustmentChange: {
                basis: event.after.adjustment.basis,
                before: event.after.adjustment.before,
                after: event.after.adjustment.after,
              },
              amount: event.after.adjustment.delta,
            }
          : {
              ...(event.before ? { before: snapshotTotal(event.before) } : {}),
              amount: snapshotTotal(event.after),
            }),
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
        state: event.after.status,
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
        state: event.after.status ?? "unknown",
        title: event.before ? "কাজের তথ্য বদলেছি" : "মিস্ত্রির কাজ রেখেছি",
        subject: event.after.title || people.get(job.personId) || "কাজ",
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
        subject: job.title || people.get(job.personId) || "কাজ",
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
  return events
    .map((event) => ({
      event,
      at: RecordedTime.safeParse(event.at).success ? Date.parse(event.at) : NaN,
    }))
    .filter(({ at }) => Number.isFinite(at))
    .sort((a, b) => b.at - a.at || a.event.id.localeCompare(b.event.id))
    .map(({ event }) => event);
}

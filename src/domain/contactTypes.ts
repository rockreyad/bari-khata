import { z } from "zod";
import type { ContactAction, Ledger, Person, PersonKind } from "./model.js";
import { personKind } from "./contactKind.js";
import { normalizeLabel } from "../lib/normalizeLabel.js";

export const ContactTypeSchema = z.enum([
  "supplier",
  "craftsperson",
  "labour",
  "contractor",
  "professional",
  "transport",
  "service",
  "custom",
]);
export type ContactType = z.infer<typeof ContactTypeSchema>;

export type ContactPreset = {
  id: ContactType;
  label: string;
  description: string;
  kind: PersonKind;
  role: string;
  roles: string[];
  aliases?: string[];
  actions: ContactAction[];
  agreement: boolean;
};

export const contactPresets: ContactPreset[] = [
  {
    id: "supplier",
    label: "দোকানদার",
    description: "দোকান, ডিলার বা মাল বিক্রেতা",
    kind: "shop",
    role: "",
    roles: [
      "সিমেন্ট ও রড",
      "ইট",
      "বালু ও পাথর",
      "রং",
      "স্যানিটারি মাল",
      "ইলেকট্রিক মাল",
    ],
    actions: ["payment", "purchase", "return"],
    agreement: false,
  },
  {
    id: "craftsperson",
    label: "মিস্ত্রি / কারিগর",
    description: "রাজমিস্ত্রি, কাঠ, রং বা লাইনের কাজ",
    kind: "worker",
    role: "মিস্ত্রি",
    roles: [
      "রাজমিস্ত্রি",
      "রড মিস্ত্রি",
      "কাঠমিস্ত্রি",
      "টাইলস মিস্ত্রি",
      "রঙের মিস্ত্রি",
      "ইলেকট্রিক মিস্ত্রি",
      "প্লাম্বার",
    ],
    aliases: [
      "Mason",
      "Carpenter",
      "Electrician",
      "Plumber",
      "Painter",
      "কারেন্টের মিস্ত্রি",
      "কারেন্ট মিস্ত্রি",
      "বিদ্যুতের মিস্ত্রি",
    ],
    actions: ["payment"],
    agreement: true,
  },
  {
    id: "labour",
    label: "শ্রমিক",
    description: "মাটি কাটা, বালু ভরাট বা মাল নামানো",
    kind: "worker",
    role: "শ্রমিক",
    roles: [
      "শ্রমিক",
      "লেবার",
      "মাটি কাটার শ্রমিক",
      "বালু ভরাটের শ্রমিক",
      "মাল নামানোর শ্রমিক",
      "ঢালাইয়ের শ্রমিক",
    ],
    aliases: ["Labourer", "Laborer"],
    actions: ["payment"],
    agreement: true,
  },
  {
    id: "contractor",
    label: "ঠিকাদার",
    description: "একটি ধাপ বা পুরো কাজের দায়িত্ব",
    kind: "worker",
    role: "ঠিকাদার",
    roles: [
      "ঠিকাদার",
      "রাজমিস্ত্রির ঠিকাদার",
      "রঙের ঠিকাদার",
      "সম্পূর্ণ কাজের ঠিকাদার",
    ],
    aliases: ["Contractor", "Subcontractor", "উপ ঠিকাদার", "উপঠিকাদার"],
    actions: ["payment"],
    agreement: true,
  },
  {
    id: "professional",
    label: "ইঞ্জিনিয়ার / পরামর্শক",
    description: "নকশা, মাপজোক বা কাজের তদারকি",
    kind: "worker",
    role: "ইঞ্জিনিয়ার",
    roles: [
      "ইঞ্জিনিয়ার",
      "স্থপতি",
      "ইন্টেরিয়র ডিজাইনার",
      "সার্ভেয়ার",
      "কাজের তদারকি",
    ],
    aliases: ["Engineer", "Architect", "Surveyor", "Interior designer"],
    actions: ["payment"],
    agreement: true,
  },
  {
    id: "transport",
    label: "গাড়ি / পরিবহন",
    description: "মাল আনা-নেওয়ার ভাড়া",
    kind: "driver",
    role: "গাড়িচালক",
    roles: ["ট্রাকচালক", "পিকআপচালক", "ভ্যানচালক", "ট্রলিচালক"],
    actions: ["payment", "transport"],
    agreement: false,
  },
  {
    id: "service",
    label: "অন্যান্য সেবা",
    description: "পরিষ্কার, পাহারা বা অন্য সেবা",
    kind: "worker",
    role: "",
    roles: [
      "পরিচ্ছন্নতাকর্মী",
      "সুইপার",
      "সেপটিক ট্যাংকের কাজ",
      "নিরাপত্তাকর্মী",
      "পানির ব্যবস্থা",
    ],
    aliases: ["Cleaner", "Sweeper", "Security guard"],
    actions: ["payment"],
    agreement: true,
  },
  {
    id: "custom",
    label: "নিজের মতো",
    description: "নাম লিখে দরকারি বোতাম বেছে নিন",
    kind: "other",
    role: "",
    roles: [],
    actions: ["payment"],
    agreement: true,
  },
];

export function contactTypeMatchesKind(
  type: ContactType,
  kind: PersonKind | null | undefined,
) {
  if (!kind || type === "custom") return true;
  const expected = contactPresets.find((preset) => preset.id === type)!.kind;
  return expected === "worker"
    ? kind === "worker" || kind === "other"
    : kind === expected;
}

export function contactPresetFor(
  person: Pick<Person, "kind" | "role" | "contactType"> &
    Partial<Pick<Person, "name">>,
) {
  return (
    contactPresets.find((preset) => preset.id === person.contactType) ??
    contactPresetFrom(
      personKind({
        kind: person.kind,
        role: person.role,
        name: person.name ?? "",
        contactType: person.contactType,
      }),
      person.role,
    )
  );
}

export function contactCanHaveAgreement(person: Person) {
  if (person.archivedAt) return false;
  if (person.roles === undefined)
    return (
      ["worker", "other"].includes(personKind(person)) &&
      contactPresetFor(person).agreement
    );
  return (
    person.roles.length === 0 ||
    person.roles.some((role) =>
      contactPresets.some((preset) => preset.id === role && preset.agreement),
    )
  );
}

export function preservesContactTypes(
  before: Pick<Ledger, "people">,
  after: Pick<Ledger, "people">,
) {
  const people = new Map(after.people.map((person) => [person.id, person]));
  return before.people.every(
    (person) =>
      person.contactType == null ||
      people.get(person.id)?.contactType !== undefined,
  );
}

export function contactPresetFrom(kind: PersonKind, description: string) {
  const role = normalizeLabel(description);
  const matching = contactPresets.find(
    (preset) =>
      (preset.kind === kind ||
        (kind === "other" && preset.kind === "worker")) &&
      [preset.role, ...preset.roles, ...(preset.aliases ?? [])].some(
        (value) => value && normalizeLabel(value) === role,
      ),
  );
  return (
    matching ??
    contactPresets.find((preset) =>
      kind === "worker" ? preset.id === "custom" : preset.kind === kind,
    )!
  );
}

export function contactRoles(
  person: Pick<Person, "kind" | "role" | "contactType"> &
    Partial<Pick<Person, "name" | "roles">>,
): ContactType[] {
  return person.roles === undefined
    ? [contactPresetFor(person).id]
    : person.roles;
}

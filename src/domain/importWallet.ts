import { parseMoneyText } from "./money";
import { z } from "zod";
import { LedgerSchema, type CostType, type Entry, type Ledger } from "./model";

export const WalletGridSchema = z.record(
  z.string(),
  z.object({
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    cells: z.record(z.string().regex(/^[A-Z]+[1-9]\d*$/), z.string()),
  }),
);
export type WalletGrid = z.infer<typeof WalletGridSchema>;

export const materialGroups = [
  {
    id: "steel",
    name: "লোহা ও রড",
    aliases: ["steel", "rod", "loha", "guna", "তারকাঁটা"],
  },
  { id: "cement", name: "সিমেন্ট", aliases: ["cement"] },
  { id: "sand", name: "বালু", aliases: ["sand", "balu"] },
  { id: "bricks", name: "ইট", aliases: ["bricks", "ইট ভাঙা"] },
  { id: "chemical", name: "কেমিক্যাল", aliases: ["chemical", "dr fixit"] },
  { id: "polythene", name: "পলিথিন", aliases: ["polithin", "tripol"] },
  {
    id: "electrical",
    name: "বিদ্যুতের মালামাল",
    aliases: ["electric", "cable", "light"],
  },
  {
    id: "plumbing",
    name: "পানির লাইন ও বাথরুমের মাল",
    aliases: ["plumbing", "sanitary", "pipe"],
  },
  { id: "tiles", name: "টাইলস", aliases: ["tiles", "টাইলসের আঠা"] },
  { id: "wood", name: "কাঠ", aliases: ["kath", "wood"] },
  { id: "door", name: "দরজা", aliases: ["door", "wpc"] },
  { id: "paint", name: "রং", aliases: ["paint", "rong"] },
  {
    id: "tools",
    name: "যন্ত্রপাতি ও ছোটখাটো মাল",
    aliases: ["tools", "machine", "mesh"],
  },
  { id: "food", name: "খাবার ও নাশতা", aliases: ["khawa", "nasta"] },
  { id: "electricity", name: "বিদ্যুৎ বিল", aliases: ["current bill"] },
];

const itemDefinitions = [
  ["steel", "লোহা ও রড", "steel", "", ""],
  ["steel-wire", "লোহার বাঁধাই তার", "steel", "", ""],
  ["steel-aks", "AKS রড", "steel", "AKS", ""],
  ["steel-ms", "MS বার", "steel", "", "MS বার"],
  ["steel-square", "স্কয়ার বার", "steel", "", "স্কয়ার বার"],
  ["steel-flat", "লোহার পাত", "steel", "", "পাত"],
  ["cement", "সিমেন্ট", "cement", "", ""],
  ["cement-crown", "Crown সিমেন্ট", "cement", "Crown", ""],
  ["cement-shah", "Shah সিমেন্ট", "cement", "Shah", ""],
  ["cement-supercrete", "Supercrete+ সিমেন্ট", "cement", "Supercrete+", ""],
  ["cement-inchi", "Inchi সিমেন্ট", "cement", "Inchi", ""],
  ["sand", "বালু", "sand", "", ""],
  ["sand-fill", "ভরাটের বালু", "sand", "", "ভরাট"],
  ["sand-plaster", "প্লাস্টারের বালু", "sand", "", "প্লাস্টার"],
  ["sand-casting", "ঢালাইয়ের বালু", "sand", "", "ঢালাই"],
  ["bricks", "ইট", "bricks", "", ""],
  ["bricks-picked", "পিকেট ইট", "bricks", "", "পিকেট"],
  ["bricks-auto", "অটো ইট", "bricks", "", "অটো"],
  ["chemical", "কেমিক্যাল", "chemical", "", ""],
  ["chemical-fixit", "Dr Fixit", "chemical", "Dr Fixit", ""],
  ["chemical-baral", "Baral কেমিক্যাল", "chemical", "Baral", ""],
  ["polythene", "পলিথিন", "polythene", "", ""],
  ["electrical", "বিদ্যুতের মালামাল", "electrical", "", ""],
  ["plumbing", "পানির লাইন ও বাথরুমের মাল", "plumbing", "", ""],
  ["wood", "কাঠ", "wood", "", ""],
  ["door", "দরজা", "door", "", ""],
  ["paint", "রং", "paint", "", ""],
  ["tools", "যন্ত্রপাতি ও ছোটখাটো মাল", "tools", "", ""],
  ["food", "খাবার ও নাশতা", "food", "", ""],
  ["electricity", "বিদ্যুৎ বিল", "electricity", "", ""],
] as const;

export function defaultTaxonomy() {
  return {
    materialGroups: materialGroups.map((group) => ({
      ...group,
      aliases: [...group.aliases],
    })),
    items: itemDefinitions.map(([id, name, materialGroupId, brand, usage]) => ({
      id,
      name,
      materialGroupId,
      brand,
      usage,
      unit: "",
      aliases: [],
    })),
  };
}

type Block = {
  id: string;
  header: string;
  amount: string;
  note: string;
  date?: string;
  quantity?: string;
  from: number;
  to: number;
  name: string;
  group?: string;
  party?: boolean;
  color: string;
  icon: string;
};
const detailFile = "Home Construstion.html";
const summaryFile = "TOTAL HOME COST.html";
const blocks: Block[] = [
  {
    id: "structure",
    header: "B7",
    amount: "D",
    note: "C",
    date: "B",
    from: 8,
    to: 110,
    name: "নির্মাণের পুরোনো খাতা",
    party: true,
    color: "amber",
    icon: "building",
  },
  {
    id: "bricks",
    header: "F7",
    amount: "H",
    note: "G",
    from: 8,
    to: 99,
    name: "ইট কেনা",
    group: "bricks",
    color: "coral",
    icon: "bricks",
  },
  {
    id: "sand",
    header: "J7",
    amount: "L",
    note: "K",
    from: 8,
    to: 99,
    name: "বালু কেনা",
    group: "sand",
    color: "amber",
    icon: "sand",
  },
  {
    id: "cement",
    header: "N7",
    amount: "P",
    note: "O",
    quantity: "N",
    from: 8,
    to: 99,
    name: "সিমেন্ট কেনা",
    group: "cement",
    color: "slate",
    icon: "cement",
  },
  {
    id: "electric-material",
    header: "R7",
    amount: "T",
    note: "S",
    date: "R",
    from: 8,
    to: 99,
    name: "বিদ্যুতের মালামাল",
    group: "electrical",
    color: "amber",
    icon: "electric",
  },
  {
    id: "other",
    header: "V7",
    amount: "X",
    note: "W",
    from: 8,
    to: 99,
    name: "অন্যান্য খরচ",
    color: "plum",
    icon: "other",
  },
  {
    id: "steel",
    header: "F100",
    amount: "H",
    note: "G",
    from: 101,
    to: 119,
    name: "লোহা ও রড কেনা",
    group: "steel",
    color: "slate",
    icon: "steel",
  },
  {
    id: "sanitary",
    header: "J100",
    amount: "L",
    note: "K",
    date: "J",
    from: 101,
    to: 119,
    name: "পানির লাইন ও বাথরুমের মাল",
    group: "plumbing",
    color: "blue",
    icon: "plumbing",
  },
  {
    id: "door",
    header: "N100",
    amount: "P",
    note: "O",
    date: "N",
    from: 101,
    to: 119,
    name: "দরজার কাজ",
    group: "door",
    color: "wood",
    icon: "door",
  },
  {
    id: "finishing",
    header: "F120",
    amount: "H",
    note: "G",
    date: "F",
    from: 121,
    to: 170,
    name: "মিস্ত্রির পুরোনো খাতা",
    party: true,
    color: "sage",
    icon: "worker",
  },
  {
    id: "plumber",
    header: "J120",
    amount: "L",
    note: "K",
    date: "J",
    from: 121,
    to: 170,
    name: "পানির লাইনের কাজ",
    party: true,
    color: "blue",
    icon: "plumbing",
  },
  {
    id: "electrician",
    header: "N120",
    amount: "P",
    note: "O",
    date: "N",
    from: 121,
    to: 170,
    name: "বিদ্যুতের কাজ",
    party: true,
    color: "amber",
    icon: "electric",
  },
  {
    id: "grill",
    header: "R120",
    amount: "T",
    note: "S",
    date: "R",
    from: 121,
    to: 170,
    name: "গ্রিলের কাজ",
    party: true,
    color: "slate",
    icon: "steel",
  },
];

export function sourceAmount(text: string): number {
  return parseMoneyText(text, { signed: true });
}

function sourceDate(value: string): string | null {
  if (!value.trim()) return null;
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

type Classification = {
  group: string | null;
  item: string | null;
  usage: string;
  costType: CostType;
  mixed: boolean;
};
function classify(block: Block, note: string): Classification {
  const text = note.toLowerCase().replace(/\s+/g, " ");
  let group: string | null = block.group ?? null;
  let item: string | null = null;
  let usage = "";
  let costType: CostType = group ? "material" : "other";
  let mixed = false;
  const hints: string[] = [];
  if (
    /guna|\bloha\b|\brod\b|\bsteel\b|ms bar|sq bar|plain pati|\baks\b/.test(
      text,
    )
  )
    hints.push("steel");
  if (/polithin|polyth|tripol/.test(text)) hints.push("polythene");
  if (/dr\s*fixit|chemical/.test(text)) hints.push("chemical");
  if (/\bkath\b|\bwood\b/.test(text)) hints.push("wood");
  if (/\brong\b/.test(text)) hints.push("paint");
  if (/curr(?:ent|net) bill/.test(text)) hints.push("electricity");
  if (/\bnasta\b|khawa|\bmisti\b/.test(text)) hints.push("food");
  if (/flood\s*light|dynamo/.test(text)) hints.push("electrical");
  if (/boarding|pipe/.test(text) && block.id === "other")
    hints.push("plumbing");
  if (/\b(mesh|chok|blate|belet|jharu|bodna|chair|balti|mog)\b/.test(text))
    hints.push("tools");
  const unique = [...new Set(hints)];
  if (!group && unique.length === 1) group = unique[0];
  if (unique.length > 1) {
    group = null;
    mixed = true;
  }
  if (block.id === "door" && unique.length === 1) group = unique[0];
  if (group && costType === "other") costType = "material";
  if (/unload|namano/.test(text)) costType = "unload";
  else if (/trolli|gari\s*vara|van\s*vara/.test(text)) costType = "transport";
  else if (/lebar|vanga|sorano/.test(text)) costType = "labour";
  else if (/kath vara|rod machine/.test(text)) costType = "rental";
  else if (/salary|beton|\bmistri\b|technisian|\d\s*jon/.test(text) && !group)
    costType = "labour";
  if (block.id === "electric-material" && /^mistri$/i.test(note.trim()))
    costType = "labour";
  if (block.id === "steel" && /nasta/.test(text)) {
    group = "food";
    costType = "other";
  }
  if (block.id === "sand") {
    const fill = /bi[bt]?\s*balu|bitbalu|bibalu/.test(text);
    const plaster = /plaster/.test(text);
    const casting = /dhalai/.test(text);
    if ([fill, plaster, casting].filter(Boolean).length > 1) {
      mixed = true;
      usage = "";
    } else
      usage = fill ? "ভরাট" : plaster ? "প্লাস্টার" : casting ? "ঢালাই" : "";
  }
  if (
    (/\bit\s*\+\s*trolli|beton\s*\+|chaer|salary/.test(text) &&
      /kath|gaibandha|trolli/.test(text)) ||
    /2000\s*,\s*it|base polithin|polithin,|guna.*chok/.test(text)
  )
    mixed = true;
  const uncertainContractorMix =
    block.party &&
    /\d/.test(text) &&
    /guna|kath|van vara|sheet|rong/.test(text) &&
    !/^(?:\d+(?:\.\d+)?\s*(?:kg\s*)?(?:guna|jon)|kath vara)$/i.test(
      text.trim(),
    );
  if (uncertainContractorMix) {
    mixed = true;
    group = null;
    costType = "other";
  }
  if (block.id === "structure" && /^2kg guna, loha$/i.test(text)) {
    group = "steel";
    costType = "material";
  }
  if (/^(?:due|advance)$/i.test(text)) {
    costType = "other";
  }
  if (block.id === "other" && group && ["food", "electricity"].includes(group))
    costType = "other";
  if (mixed && costType === "transport" && /\bit\b/.test(text))
    costType = "material";
  if (group === "cement") {
    item = /crown/.test(text)
      ? "cement-crown"
      : /shah/.test(text)
        ? "cement-shah"
        : /supercrete/.test(text)
          ? "cement-supercrete"
          : /inchi/.test(text)
            ? "cement-inchi"
            : "cement";
  } else if (group === "sand")
    item =
      usage === "ভরাট"
        ? "sand-fill"
        : usage === "প্লাস্টার"
          ? "sand-plaster"
          : usage === "ঢালাই"
            ? "sand-casting"
            : "sand";
  else if (group === "bricks")
    item = /picked/.test(text)
      ? "bricks-picked"
      : /auto/.test(text)
        ? "bricks-auto"
        : "bricks";
  else if (group === "steel")
    item = /guna/.test(text)
      ? "steel-wire"
      : /\baks\b/.test(text)
        ? "steel-aks"
        : /plain pati/.test(text)
          ? "steel-flat"
          : /sq bar/.test(text)
            ? "steel-square"
            : /ms bar/.test(text)
              ? "steel-ms"
              : "steel";
  else if (group === "chemical")
    item = /fixit/.test(text)
      ? "chemical-fixit"
      : /bar[ae]l/.test(text)
        ? "chemical-baral"
        : "chemical";
  else if (group && itemDefinitions.some(([id]) => id === group)) item = group;
  // A supporting charge only gets a brand when its own note names that brand.
  if (
    (costType !== "material" &&
      !(group === "cement" && /crown|shah|supercrete|inchi/.test(text))) ||
    mixed
  )
    item = null;
  return { group, item, usage, costType, mixed };
}

export type WalletRow = {
  id: string;
  block: string;
  ledger: string;
  cell: string;
  noteCell: string;
  dateCell: string | null;
  quantityCell: string | null;
  rawAmount: string;
  rawDate: string;
  rawNote: string;
  rawQuantity: string;
  amount: number;
  date: string | null;
  classification: Classification;
};

export function importWallet(input: unknown, existing?: Ledger) {
  const grid = WalletGridSchema.parse(input);
  const detail = grid[detailFile];
  const summary = grid[summaryFile];
  if (!detail || !summary)
    throw new Error("Both original wallet sheets are required");
  const base = existing
    ? LedgerSchema.parse(existing)
    : LedgerSchema.parse({ project: { id: "my-home", name: "আমার বাড়ি" } });
  const taxonomy = defaultTaxonomy();
  const rows: WalletRow[] = [];
  const entries: Entry[] = [];
  const works = blocks.map((block) => ({
    id: `wallet-${block.id}`,
    name:
      block.party && ["structure", "finishing"].includes(block.id)
        ? `${detail.cells[block.header]} — পুরোনো খাতা`
        : block.name,
    description: `মূল খাতা: ${detail.cells[block.header] ?? block.id}`,
    status: "ongoing",
    color: block.color,
    icon: block.icon,
  }));
  const partyByBlock = new Map<string, string>();
  const peopleByName = new Map<
    string,
    { id: string; name: string; role: string; phone: string }
  >();
  for (const block of blocks.filter((value) => value.party)) {
    const header = detail.cells[block.header] ?? block.name;
    const name = header.match(/\(([^)]+)\)/)?.[1]?.trim() || header;
    const key = name.toLocaleLowerCase().replace(/\s+/g, " ");
    const person = peopleByName.get(key) ?? {
      id: `wallet-party-${block.id}`,
      name,
      role: "পুরোনো খাতায় লেখা ব্যক্তি বা দল",
      phone: "",
    };
    peopleByName.set(key, person);
    partyByBlock.set(block.id, person.id);
  }
  const people = [...peopleByName.values()];
  for (const block of blocks) {
    const ledgerName = detail.cells[block.header] ?? block.id;
    for (let row = block.from; row <= block.to; row++) {
      const cell = `${block.amount}${row}`;
      const rawAmount = detail.cells[cell];
      if (!rawAmount) continue;
      const id = `wallet:home-construction:${cell}`;
      const rawNote = detail.cells[`${block.note}${row}`] ?? "";
      const rawDate = block.date
        ? (detail.cells[`${block.date}${row}`] ?? "")
        : "";
      const rawQuantity = block.quantity
        ? (detail.cells[`${block.quantity}${row}`] ?? "")
        : "";
      const amount = sourceAmount(rawAmount);
      if (!amount) throw new Error(`Zero amount requires review: ${cell}`);
      const date = sourceDate(rawDate);
      const classification = classify(block, rawNote);
      const reasons = [
        "পুরোনো খাতার খরচ; বিল ও টাকা দেওয়ার হিসাব আলাদা করে নিশ্চিত করা হয়নি।",
      ];
      if (!rawNote) reasons.push("মূল ঘরে বিবরণ নেই।");
      if (classification.mixed)
        reasons.push("এক টাকায় একাধিক খরচ আছে; অনুমান করে ভাগ করা হয়নি।");
      if (rawDate && !date)
        reasons.push("মূল তারিখটি নির্ভরযোগ্য তারিখ হিসেবে পড়া যায়নি।");
      if (
        /advance|\bdue\b|baki|\bdhar\b|pabo|adjustment|khata theke|hisab nibo/i.test(
          rawNote,
        )
      )
        reasons.push(
          "অগ্রিম, বাকি, সমন্বয় বা অন্য খাতার উল্লেখ আছে; ব্যালেন্সে ধরা হয়নি।",
        );
      if (!classification.group) reasons.push("মালের ধরন নিশ্চিত নয়।");
      rows.push({
        id,
        block: block.id,
        ledger: ledgerName,
        cell,
        noteCell: `${block.note}${row}`,
        dateCell: block.date ? `${block.date}${row}` : null,
        quantityCell: block.quantity ? `${block.quantity}${row}` : null,
        rawAmount,
        rawDate,
        rawNote,
        rawQuantity,
        amount,
        date,
        classification,
      });
      entries.push({
        id,
        kind: amount < 0 ? "expense_credit" : "expense",
        date,
        note: rawNote,
        personId: partyByBlock.get(block.id) ?? null,
        account:
          classification.costType === "labour"
            ? "labour"
            : classification.costType === "material"
              ? "materials"
              : "other",
        paymentPurposeId: null,
        contractId: null,
        relatedEntryId: null,
        balanceImpact: "historical",
        reviewStatus: "needs_review",
        reviewReason: reasons.join(" "),
        source: {
          file: detailFile,
          sheet: "Home Construstion",
          cell,
          note: rawNote,
          checksum: detail.checksum,
          ledger: ledgerName,
        },
        lines: [
          {
            id: `${id}:line`,
            workId: `wallet-${block.id}`,
            label: rawNote || ledgerName,
            itemId: classification.item,
            materialGroupId: classification.group,
            usage: classification.usage,
            costType: classification.costType,
            amount: Math.abs(amount),
            quantity: rawQuantity,
            unit: block.quantity && rawQuantity ? "বস্তা" : "",
          },
        ],
        allocations: [],
        paymentParts: [],
        receipts: [],
        createdAt: "",
        updatedAt: "",
        voided: false,
        revisions: [],
      });
    }
  }
  const combine = <T extends { id: string }>(old: T[], added: T[]) => {
    const found = new Map(old.map((value) => [value.id, value]));
    for (const value of added)
      if (!found.has(value.id)) found.set(value.id, value);
    return [...found.values()];
  };
  for (const entry of entries) {
    const present = base.entries.find((value) => value.id === entry.id);
    if (
      present &&
      (present.source?.checksum !== detail.checksum ||
        present.source?.cell !== entry.source?.cell)
    )
      throw new Error(
        `Source changed for ${entry.id}; review the existing import before replacing it`,
      );
  }
  const ledger = LedgerSchema.parse({
    ...base,
    isDemo: false,
    works: combine(base.works, works),
    people: combine(base.people, people),
    materialGroups: combine(base.materialGroups, taxonomy.materialGroups),
    items: combine(base.items, taxonomy.items),
    entries: combine(base.entries, entries),
  });
  const perLedger = blocks.map((block) => {
    const values = rows.filter((row) => row.block === block.id);
    return {
      block: block.id,
      name: detail.cells[block.header],
      count: values.length,
      amount: values.reduce((sum, row) => sum + row.amount, 0),
    };
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const componentCells = [
    "E8",
    "E10",
    "E12",
    "E14",
    "E16",
    "J8",
    "J10",
    "J12",
    "J14",
    "J16",
    "J18",
    "J20",
    "J22",
  ];
  const components = componentCells.map((cell) => ({
    cell,
    amount: sourceAmount(summary.cells[cell] ?? "0"),
  }));
  const componentTotal = components.reduce((sum, row) => sum + row.amount, 0);
  const headline = sourceAmount(summary.cells.F3 ?? "0");
  const chemicalRows = rows.filter(
    (row) => row.classification.group === "chemical",
  );
  const steelAmount =
    perLedger.find((group) => group.block === "steel")?.amount ?? 0;
  const otherAmount =
    perLedger.find((group) => group.block === "other")?.amount ?? 0;
  const unmappedMoneyCells = Object.entries(detail.cells)
    .filter(
      ([cell, value]) =>
        /৳/.test(value) &&
        cell !== "D111" &&
        !rows.some((row) => row.cell === cell),
    )
    .map(([cell]) => cell);
  const report = {
    sourceChecksums: Object.fromEntries(
      Object.entries(grid).map(([file, sheet]) => [file, sheet.checksum]),
    ),
    rowCount: rows.length,
    importedCount: entries.filter(
      (entry) => !base.entries.some((value) => value.id === entry.id),
    ).length,
    missingDateCount: rows.filter((row) => !row.date).length,
    invalidDates: rows
      .filter((row) => row.rawDate && !row.date)
      .map((row) => ({ cell: row.dateCell, rawDate: row.rawDate })),
    historicalRecordedCost: total,
    confirmedCost: 0,
    confirmedPayments: 0,
    payable: 0,
    advance: 0,
    unreviewedCount: rows.length,
    perLedger,
    unmappedMoneyCells,
    detailSubtotal: {
      cell: "D111",
      amount: sourceAmount(detail.cells.D111 ?? "0"),
      calculated:
        perLedger.find((group) => group.block === "structure")?.amount ?? 0,
    },
    summary: {
      headlineCell: "F3",
      headline,
      components,
      componentTotal,
      detailVsHeadline: total - headline,
      detailVsComponents: total - componentTotal,
      componentVsHeadline: componentTotal - headline,
      discrepancies: [
        {
          code: "displayed-components-vs-headline",
          amount: componentTotal - headline,
          sourceCells: ["F3", ...componentCells],
          note: "Displayed summary components do not add up to the displayed headline. The difference equals E12; original formulas are unavailable.",
        },
        {
          code: "steel-detail-vs-summary",
          amount: steelAmount - sourceAmount(summary.cells.J10 ?? "0"),
          sourceCells: ["H111", "H112", "J10"],
          note: "The steel detail exceeds its summary by exactly the final two steel lines. No source value was changed.",
        },
        {
          code: "other-detail-beyond-summary-chemical",
          amount: otherAmount - sourceAmount(summary.cells.J20 ?? "0"),
          sourceCells: ["X8:X56", "J20"],
          note: "Other detail includes more than the chemical amount shown in the summary. These detail records are retained once each.",
        },
      ],
    },
    chemical: {
      detailAmount: chemicalRows.reduce((sum, row) => sum + row.amount, 0),
      summaryAmount: sourceAmount(summary.cells.J20 ?? "0"),
      rows: chemicalRows.map((row) => row.cell),
    },
    adjustments: rows
      .filter((row) => /adjustment/i.test(row.rawNote))
      .map((row) => ({ cell: row.cell, amount: row.amount })),
    unsplitMixedRows: rows
      .filter((row) => row.classification.mixed)
      .map((row) => row.cell),
  };
  return { ledger, rows, report };
}

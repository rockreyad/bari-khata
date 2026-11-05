import { validateLedger, type Entry, type Ledger } from "./model";

export function createEmptyLedger(): Ledger {
  return validateLedger({
    schemaVersion: 1,
    architectureVersion: 2,
    milestones: [],
    paymentAllocations: [],
    isDemo: false,
    project: { id: "my-home", name: "আমার বাড়ি", currency: "BDT" },
    works: [],
    people: [],
    items: [],
    contracts: [],
    entries: [],
  });
}

export function createDemoLedger(): Ledger {
  const entries: unknown[] = [];
  const expense = (
    id: string,
    workId: string,
    personId: string,
    itemId: string | null,
    label: string,
    costType: string,
    amount: number,
    date: string,
    account = "materials",
    contractId: string | null = null,
  ) => {
    entries.push({
      id,
      kind: "expense",
      date,
      note: label,
      personId,
      account,
      contractId,
      lines: [
        {
          id: `${id}-line`,
          workId,
          itemId,
          label,
          costType,
          amount: amount * 100,
          quantity: "",
          unit: "",
        },
      ],
      createdAt: `${date}T10:00:00Z`,
      updatedAt: `${date}T10:00:00Z`,
    });
  };
  const payment = (
    id: string,
    workId: string,
    personId: string,
    amount: number,
    date: string,
    account = "materials",
    contractId: string | null = null,
    note = "",
  ) => {
    entries.push({
      id,
      kind: "payment",
      date,
      note,
      personId,
      account,
      contractId,
      allocations: [{ workId, amount: amount * 100 }],
      paymentParts: [
        {
          method: id.endsWith("cash") ? "cash" : "bkash",
          amount: amount * 100,
        },
      ],
      createdAt: `${date}T11:00:00Z`,
      updatedAt: `${date}T11:00:00Z`,
    });
  };
  expense(
    "tiles-first",
    "tiles",
    "shop",
    "tile",
    "প্রথমবার টাইলস কেনা",
    "material",
    700000,
    "2026-10-08",
  );
  payment("tiles-first-paid-cash", "tiles", "shop", 700000, "2026-10-08");
  expense(
    "glue-first",
    "tiles",
    "shop",
    "adhesive",
    "টাইলস লাগানোর আঠা",
    "material",
    12000,
    "2026-10-10",
  );
  payment("glue-first-paid", "tiles", "shop", 12000, "2026-10-10");
  expense(
    "clips",
    "tiles",
    "shop",
    "clip",
    "টাইলসের ক্লিপ",
    "material",
    3500,
    "2026-10-10",
  );
  payment("clips-paid-cash", "tiles", "shop", 3500, "2026-10-10");
  payment(
    "wage-1",
    "tiles",
    "tile-worker",
    10000,
    "2026-10-12",
    "labour",
    "tiles-contract",
    "কাজ চলার সময় টাকা দেওয়া",
  );
  expense(
    "tiles-extra",
    "tiles",
    "shop",
    "tile",
    "কম পড়ায় আরও টাইলস কেনা",
    "material",
    20000,
    "2026-10-18",
  );
  payment("tiles-extra-paid", "tiles", "shop", 20000, "2026-10-18");
  expense(
    "glue-extra",
    "tiles",
    "shop",
    "adhesive",
    "আরও আঠা কেনা",
    "material",
    8000,
    "2026-10-21",
  );
  payment("glue-extra-paid", "tiles", "shop", 8000, "2026-10-21");
  payment(
    "wage-2-cash",
    "tiles",
    "tile-worker",
    15000,
    "2026-10-22",
    "labour",
    "tiles-contract",
  );
  expense(
    "cutting-stone",
    "tiles",
    "shop",
    "cutting",
    "টাইলস কাটার পাথর",
    "material",
    1500,
    "2026-10-24",
  );
  payment("cutting-paid-cash", "tiles", "shop", 1500, "2026-10-24");
  expense(
    "tiles-transport",
    "tiles",
    "driver",
    null,
    "মাল আনার গাড়িভাড়া",
    "transport",
    4000,
    "2026-10-24",
  );
  payment("tiles-transport-paid-cash", "tiles", "driver", 4000, "2026-10-24");
  expense(
    "tiles-earned",
    "tiles",
    "tile-worker",
    null,
    "এ পর্যন্ত শেষ করা কাজের মজুরি",
    "labour",
    60000,
    "2026-10-31",
    "labour",
    "tiles-contract",
  );
  payment(
    "wage-3",
    "tiles",
    "tile-worker",
    20000,
    "2026-11-01",
    "labour",
    "tiles-contract",
    "বাড়িতে গিয়ে টাকা দেওয়া",
  );
  expense(
    "plaster-earned",
    "plaster",
    "plaster-worker",
    null,
    "পলেস্তারার কাজের মজুরি",
    "labour",
    65000,
    "2026-10-30",
    "labour",
  );
  payment(
    "plaster-paid",
    "plaster",
    "plaster-worker",
    50000,
    "2026-11-01",
    "labour",
    null,
    "এই সপ্তাহের টাকা",
  );
  expense(
    "worker-voucher",
    "electric",
    "electric-worker",
    "switch",
    "মিস্ত্রি নিজের টাকায় মাল কিনেছেন",
    "material",
    1500,
    "2026-10-31",
  );
  payment(
    "worker-repaid",
    "electric",
    "electric-worker",
    1700,
    "2026-11-01",
    "materials",
    null,
    "মালের টাকা ফেরত; বাড়তি ২০০ টাকা তার কাছে আছে",
  );
  return validateLedger({
    schemaVersion: 1,
    architectureVersion: 2,
    milestones: [],
    paymentAllocations: [],
    isDemo: true,
    project: { id: "demo-home", name: "নমুনা বাড়ি", currency: "BDT" },
    works: [
      {
        id: "tiles",
        name: "টাইলসের কাজ",
        description: "মাল কেনা থেকে মিস্ত্রির মজুরি",
        color: "sage",
        icon: "tiles",
        status: "ongoing",
      },
      {
        id: "plaster",
        name: "প্লাস্টারের কাজ",
        description: "কাজ প্রায় শেষ",
        color: "peach",
        icon: "plaster",
        status: "ongoing",
      },
      {
        id: "electric",
        name: "বিদ্যুতের কাজ",
        description: "তার, সুইচ আর মিস্ত্রির হিসাব",
        color: "lavender",
        icon: "electric",
        status: "ongoing",
      },
      {
        id: "paint",
        name: "রঙের কাজ",
        description: "কাজ শুরু হলে হিসাব লিখবেন",
        color: "blue",
        icon: "paint",
        status: "planned",
      },
    ],
    people: [
      { id: "tile-worker", name: "করিম মিস্ত্রি", role: "টাইলস মিস্ত্রি" },
      {
        id: "plaster-worker",
        name: "রহিম মিস্ত্রি",
        role: "পলেস্তারার মিস্ত্রি",
      },
      {
        id: "electric-worker",
        name: "সোহেল মিস্ত্রি",
        role: "বিদ্যুতের মিস্ত্রি",
      },
      { id: "shop", name: "টাইলসের দোকান", role: "মালের দোকান" },
      { id: "driver", name: "গাড়িচালক", role: "মাল আনা" },
    ],
    items: [
      { id: "tile", name: "টাইলস", unit: "বর্গফুট", aliases: ["Tiles"] },
      {
        id: "adhesive",
        name: "টাইলসের আঠা",
        unit: "ব্যাগ",
        aliases: ["Adhesive", "গাম", "Gum"],
      },
      { id: "clip", name: "টাইলসের ক্লিপ", unit: "প্যাকেট" },
      { id: "cutting", name: "টাইলস কাটার পাথর", unit: "টি" },
      { id: "switch", name: "সুইচ ও তার", unit: "" },
    ],
    contracts: [
      {
        id: "tiles-contract",
        workId: "tiles",
        personId: "tile-worker",
        title: "টাইলস লাগানোর মজুরি",
        basis: "sqft",
        quantity: "5700",
        rate: 2200,
        total: 12540000,
        notes: "প্রতি বর্গফুট ২২ টাকা",
      },
    ],
    entries: entries as Entry[],
  });
}

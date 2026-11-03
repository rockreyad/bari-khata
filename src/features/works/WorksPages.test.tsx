// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { LedgerSchema } from "../../domain/model";
import { WorkCard, WorkPage, WorksPage } from "./WorksPages";
const context = vi.hoisted(() => ({
  go: vi.fn(),
  add: vi.fn(),
  entity: vi.fn(),
  ledger: {} as unknown,
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ...context,
    entity: context.entity,
    detail: vi.fn(),
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    formatDigits: String,
    date: String,
    language: "bn",
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows only a recent preview while keeping the complete work total and a scoped history route", async () => {
  context.ledger = LedgerSchema.parse({
    works: [{ id: "cement", name: "সিমেন্ট" }],
    entries: Array.from({ length: 65 }, (_, index) => ({
      id: `bill-${index}`,
      kind: "expense",
      date: "2026-11-01",
      createdAt: `2026-11-01T00:${String(index % 60).padStart(2, "0")}:00Z`,
      lines: [
        {
          id: `line-${index}`,
          workId: "cement",
          label: `সিমেন্ট ${index}`,
          amount: 100000,
        },
      ],
    })),
  });
  const { container } = render(
    <MemoryRouter initialEntries={["/works/cement?tab=material"]}>
      <Routes>
        <Route path="/works/:workId" element={<WorkPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(container.querySelectorAll(".history-row")).toHaveLength(10);
  expect(container.querySelector(".work-scope-summary")?.textContent).toContain(
    "৳65000",
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "পুরো হিসাব" }));
  expect(context.go).toHaveBeenCalledWith(
    "/ledger?work=cement&account=materials",
  );
});

it("opens a work with all payments visible and one paid total, without advance jargon or zero dues", async () => {
  context.ledger = LedgerSchema.parse({
    works: [
      {
        id: "door",
        name: "দরজা",
        quickActions: ["expense", "payment", "labour"],
      },
    ],
    people: [{ id: "shah", name: "শাহ আলম", kind: "worker" }],
    entries: [
      {
        id: "weekly",
        kind: "payment",
        account: "labour",
        personId: "shah",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
    ],
  });
  const { container } = render(
    <MemoryRouter initialEntries={["/works/door"]}>
      <Routes>
        <Route path="/works/:workId" element={<WorkPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("button", { name: "সব লেনদেন", pressed: true }),
  ).toBeTruthy();
  expect(container.querySelectorAll(".history-payment")).toHaveLength(1);
  expect(
    container.querySelector(".work-overview-total")?.textContent,
  ).toContain("৳30000");
  expect(container.querySelector(".work-known-due")).toBeNull();
  expect(container.querySelector(".work-paid-strip")).toBeNull();
  expect(screen.getByText("শাহ আলম")).toBeTruthy();
  expect(container.querySelector(".work-balance-disclosure")).toBeNull();
  expect(screen.queryByText("অগ্রিম দিয়েছি")).toBeNull();
  expect(container.querySelector(".work-advance-note")).toBeNull();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "টাকা দিলাম" }));
  expect(context.add).toHaveBeenCalledWith({
    kind: "payment",
    workId: "door",
    account: undefined,
  });
  await user.click(screen.getByRole("button", { name: "পুরো হিসাব" }));
  expect(context.go).toHaveBeenCalledWith("/ledger?work=door");
  await user.click(screen.getByRole("button", { name: "মজুরি" }));
  expect(container.querySelectorAll(".history-payment")).toHaveLength(1);
  expect(
    container.querySelector(".work-scope-summary > strong")?.textContent,
  ).toBe("৳30000");
  expect(container.querySelector(".work-scope-summary")?.textContent).toContain(
    "কাজের মজুরি৳0",
  );
});

it("finds work names using either numeral script while preserving their stored names and ids", async () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "bn16", name: "খাতা ১৬" },
      { id: "en8", name: "ঘর 8" },
    ],
  });
  context.ledger = ledger;
  render(
    <MemoryRouter initialEntries={["/works"]}>
      <WorksPage />
    </MemoryRouter>,
  );
  const input = screen.getByRole("textbox", { name: "খাতা খুঁজুন" });
  const user = userEvent.setup();
  await user.type(input, "16");
  expect(screen.getByRole("heading", { name: "খাতা ১৬" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "ঘর 8" })).toBeNull();
  await user.clear(input);
  await user.type(input, "৮");
  expect(screen.getByRole("heading", { name: "ঘর 8" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "খাতা ১৬" })).toBeNull();
  expect(ledger.works.map((work) => [work.id, work.name])).toEqual([
    ["bn16", "খাতা ১৬"],
    ["en8", "ঘর 8"],
  ]);
});

it("shows all cash paid for doors in both its card and page while preserving the material price and shop due", async () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "cement", name: "সিমেন্ট" },
    ],
    people: [
      { id: "shop", name: "দরজার দোকান", kind: "shop" },
      { id: "design", name: "নকশার মিস্ত্রি", kind: "worker" },
      { id: "shah", name: "শাহ আলম", kind: "worker" },
    ],
    entries: [
      {
        id: "door-bill",
        kind: "expense",
        account: "materials",
        personId: "shop",
        lines: [
          { id: "door-line", workId: "door", label: "দরজা", amount: 9300000 },
        ],
      },
      {
        id: "door-paid",
        kind: "payment",
        account: "materials",
        personId: "shop",
        relatedEntryId: "door-bill",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
      {
        id: "van-bill",
        kind: "expense",
        account: "other",
        lines: [
          {
            id: "van-line",
            workId: "door",
            costType: "transport",
            label: "ভ্যানভাড়া",
            amount: 20000,
          },
        ],
      },
      {
        id: "van-paid",
        kind: "payment",
        account: "other",
        relatedEntryId: "van-bill",
        allocations: [{ workId: "door", amount: 20000 }],
        paymentParts: [{ amount: 20000 }],
      },
      {
        id: "design-bill",
        kind: "expense",
        account: "labour",
        personId: "design",
        lines: [
          {
            id: "design-line",
            workId: "door",
            costType: "labour",
            label: "দরজার নকশা",
            amount: 1600000,
          },
        ],
      },
      {
        id: "design-paid",
        kind: "payment",
        account: "labour",
        personId: "design",
        relatedEntryId: "design-bill",
        allocations: [{ workId: "door", amount: 1600000 }],
        paymentParts: [{ amount: 1600000 }],
      },
      {
        id: "weekly-paid",
        kind: "payment",
        account: "labour",
        personId: "shah",
        allocations: [{ workId: "door", amount: 3000000 }],
        paymentParts: [{ amount: 3000000 }],
      },
      {
        id: "cement-paid",
        kind: "payment",
        account: "materials",
        allocations: [{ workId: "cement", amount: 900000 }],
        paymentParts: [{ amount: 900000 }],
      },
    ].map((entry) => ({
      ...entry,
      date: "2026-11-02",
      createdAt: "2026-11-02T00:00:00Z",
    })),
  });
  const before = JSON.stringify(ledger);
  context.ledger = ledger;
  const { container } = render(
    <MemoryRouter initialEntries={["/works/door"]}>
      <WorkCard work={ledger.works[0]} ledger={ledger} onOpen={vi.fn()} />
      <Routes>
        <Route path="/works/:workId" element={<WorkPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    container.querySelector(".notebook-card-total strong")?.textContent,
  ).toBe("৳76200");
  expect(
    container.querySelector(".work-overview-total strong")?.textContent,
  ).toBe("৳76200");
  expect(
    container.querySelector(".notebook-card-due strong")?.textContent,
  ).toBe("৳63000");
  expect(container.querySelector(".work-known-due strong")?.textContent).toBe(
    "৳63000",
  );
  expect(container.querySelectorAll(".history-row")).toHaveLength(4);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^মাল$/ }));
  expect(container.querySelector(".work-scope-summary")?.textContent).toContain(
    "মালের দাম৳93000",
  );
  await user.click(screen.getByRole("button", { name: "বিস্তারিত হিসাব" }));
  expect(context.go).toHaveBeenCalledWith(
    "/reports?mode=cost&section=material&work=door",
  );
  await user.click(screen.getByRole("button", { name: "মাসে মাসে দিয়েছি" }));
  expect(
    screen.queryByRole("region", { name: "মাসে মাসে দিয়েছি" }),
  ).toBeTruthy();
  expect(JSON.stringify(ledger)).toBe(before);
});

it.each([
  ["labour only", ["labour"], true],
  ["payment only", ["payment"], true],
  ["all presets", ["expense", "payment", "labour", "transport"], true],
  ["defaults", null, true],
  ["purchase only", ["expense"], false],
  ["transport only", ["transport"], false],
  ["hidden", [], false],
] as const)(
  "offers one contextual labour payment for %s without duplicate purchase or bill actions",
  (_name, quickActions, allowed) => {
    context.ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "কাজ", quickActions }],
    });
    const { container } = render(
      <MemoryRouter initialEntries={["/works/work?tab=labour"]}>
        <Routes>
          <Route path="/works/:workId" element={<WorkPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const actions = container.querySelector<HTMLElement>(
      ".work-action-buttons",
    )!;
    expect(within(actions).queryAllByRole("button")).toHaveLength(
      allowed ? 1 : 0,
    );
    expect(
      within(actions).queryByRole("button", { name: "মজুরির বিল" }),
    ).toBeNull();
    expect(
      within(actions).queryByRole("button", { name: "খরচ লিখি" }),
    ).toBeNull();
    expect(
      within(actions).queryByRole("button", { name: "টাকা দিলাম" }),
    ).toBeNull();
    if (allowed) {
      const pay = within(actions).getByRole("button", { name: "টাকা দিই" });
      expect(pay.className).toBe("primary-button");
      fireEvent.click(pay);
      expect(context.add).toHaveBeenCalledExactlyOnceWith({
        kind: "payment",
        workId: "work",
        account: "labour",
        costType: "labour",
        purpose: "settle",
      });
    }
  },
);

it("keeps mixed work actions separate while routing the worker shortcut through contextual payment", () => {
  context.ledger = LedgerSchema.parse({
    works: [
      {
        id: "mixed",
        name: "দরজা",
        quickActions: ["expense", "payment", "labour", "transport"],
      },
    ],
  });
  const { container } = render(
    <MemoryRouter initialEntries={["/works/mixed"]}>
      <Routes>
        <Route path="/works/:workId" element={<WorkPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const actions = container.querySelector<HTMLElement>(".work-action-buttons")!;
  expect(within(actions).getAllByRole("button")).toHaveLength(4);
  fireEvent.click(
    within(actions).getByRole("button", { name: "মিস্ত্রির টাকা" }),
  );
  expect(context.add).toHaveBeenLastCalledWith({
    kind: "payment",
    workId: "mixed",
    account: "labour",
    costType: "labour",
    purpose: "settle",
  });
  fireEvent.click(within(actions).getByRole("button", { name: "খরচ লিখি" }));
  expect(context.add).toHaveBeenLastCalledWith({
    workId: "mixed",
    account: "materials",
    costType: "material",
  });
  fireEvent.click(within(actions).getByRole("button", { name: "টাকা দিলাম" }));
  expect(context.add).toHaveBeenLastCalledWith({
    kind: "payment",
    workId: "mixed",
    account: undefined,
  });
  fireEvent.click(within(actions).getByRole("button", { name: "আনার খরচ" }));
  expect(context.add).toHaveBeenLastCalledWith({
    workId: "mixed",
    account: "other",
    costType: "transport",
  });
});

function WorkRouteLocation() {
  const location = useLocation();
  return (
    <output data-testid="work-route">
      {location.pathname}
      {location.search}
    </output>
  );
}
function renderWorkTabs(path: string) {
  context.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/works/:workId"
          element={
            <>
              <WorkPage />
              <WorkRouteLocation />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

it("keeps compact colored cards clickable without footer clutter and shows due only when it exists", () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "due", name: "বাকি আছে", color: "rose", icon: "door" },
      {
        id: "settled",
        name: "বাড়ির সামনের বারান্দা ও বাথরুমের দরজার সম্পূর্ণ কাজ",
        color: "teal",
        icon: "paint",
        status: "planned",
      },
      { id: "cash", name: "শুধু টাকা দেওয়া", color: "amber", icon: "cement" },
    ],
    people: [{ id: "shop", name: "দোকান", kind: "shop" }],
    entries: [
      {
        id: "due-bill",
        kind: "expense",
        personId: "shop",
        lines: [{ id: "due-line", workId: "due", amount: 10000 }],
      },
      {
        id: "due-cash",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "due", amount: 4000 }],
        paymentParts: [{ amount: 4000 }],
      },
      {
        id: "settled-bill",
        kind: "expense",
        personId: "shop",
        lines: [{ id: "settled-line", workId: "settled", amount: 10000 }],
      },
      {
        id: "settled-cash",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "settled", amount: 10000 }],
        paymentParts: [{ amount: 10000 }],
      },
      {
        id: "cash-only",
        kind: "payment",
        personId: "shop",
        allocations: [{ workId: "cash", amount: 2500 }],
        paymentParts: [{ amount: 2500 }],
      },
    ],
  });
  const onOpen = vi.fn();
  const { container } = render(
    <div className="work-carousel">
      {ledger.works.map((work) => (
        <WorkCard
          key={work.id}
          work={work}
          ledger={ledger}
          onOpen={() => onOpen(work.id)}
        />
      ))}
    </div>,
  );
  const cards = [
    ...container.querySelectorAll<HTMLButtonElement>(".work-notebook-card"),
  ];
  expect(cards).toHaveLength(3);
  expect(screen.queryByText("খাতা খুলুন")).toBeNull();
  expect(
    cards.map((card) => card.style.getPropertyValue("--work-color")),
  ).toEqual(["#d96094", "#20a7ad", "#dc9a2e"]);
  expect(cards[0].querySelector(".work-mark.tone-rose")).not.toBeNull();
  expect(cards[1].querySelector(".status-tag.planned")).not.toBeNull();
  expect(container.querySelector("[role='progressbar']")).toBeNull();
  const longName = "বাড়ির সামনের বারান্দা ও বাথরুমের দরজার সম্পূর্ণ কাজ";
  expect(screen.getByRole("button", { name: new RegExp(longName) })).toBe(
    cards[1],
  );
  expect(cards[1].querySelector("h3")?.textContent).toBe(longName);
  expect(cards[1].querySelector("h3")?.getAttribute("title")).toBe(longName);
  for (const card of cards) {
    expect(card.querySelectorAll(".notebook-card-top")).toHaveLength(1);
    expect(card.querySelectorAll(".notebook-card-balance")).toHaveLength(1);
    expect(card.querySelector("footer")).toBeNull();
    expect(
      card.querySelector(".notebook-card-arrow[aria-hidden='true']"),
    ).not.toBeNull();
  }
  expect(cards[0].querySelector(".notebook-card-due")?.textContent).toContain(
    "৳60",
  );
  expect(
    cards[0]
      .querySelector(".notebook-card-balance")
      ?.getAttribute("aria-hidden"),
  ).toBeNull();
  for (const card of cards.slice(1)) {
    expect(card.querySelector(".notebook-card-due")).toBeNull();
    expect(
      card.querySelector(".notebook-card-balance")?.getAttribute("aria-hidden"),
    ).toBe("true");
  }
  expect(
    cards.map(
      (card) => card.querySelector(".notebook-card-total strong")?.textContent,
    ),
  ).toEqual(["৳40", "৳100", "৳25"]);
  cards.forEach((card) => fireEvent.click(card));
  expect(onOpen.mock.calls.map(([id]) => id)).toEqual([
    "due",
    "settled",
    "cash",
  ]);
});

it("keeps tab selection in the route, preserves other filters and supports native keyboard activation", async () => {
  renderWorkTabs(
    "/works/door?tab=material&account=materials&from=2026-01-01&q=cement",
  );
  const group = screen.getByRole("group", { name: "খাতার লেনদেন বেছে দেখুন" });
  expect(within(group).getAllByRole("button")).toHaveLength(6);
  for (const button of within(group).getAllByRole("button")) {
    expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  }
  const activity = within(group).getByRole("button", { name: "কাজের খবর" });
  activity.focus();
  await userEvent.setup().keyboard("{Enter}");
  expect(
    within(group).getByRole("button", { name: "কাজের খবর", pressed: true }),
  ).toBeTruthy();
  expect(screen.getByText("কাজ শুরুর তারিখ")).toBeTruthy();
  let params = new URL(
    screen.getByTestId("work-route").textContent ?? "",
    "https://bari.invalid",
  ).searchParams;
  expect(Object.fromEntries(params)).toEqual({
    tab: "activity",
    account: "materials",
    from: "2026-01-01",
    q: "cement",
  });
  const material = within(group).getByRole("button", { name: "মাল" });
  material.focus();
  await userEvent.setup().keyboard(" ");
  expect(
    within(group).getByRole("button", { name: "মাল", pressed: true }),
  ).toBeTruthy();
  params = new URL(
    screen.getByTestId("work-route").textContent ?? "",
    "https://bari.invalid",
  ).searchParams;
  expect(params.get("tab")).toBe("material");
  expect(params.get("q")).toBe("cement");
});

it("reveals the last active tab within a narrow rail and brings the first tab back without changing filters", () => {
  renderWorkTabs("/works/door?tab=activity&q=cement");
  const rail = screen.getByRole("group", { name: "খাতার লেনদেন বেছে দেখুন" });
  Object.defineProperties(rail, {
    clientWidth: { configurable: true, value: 260 },
    scrollWidth: { configurable: true, value: 610 },
  });
  const buttons = within(rail).getAllByRole("button");
  buttons.forEach((button, index) =>
    Object.defineProperties(button, {
      offsetLeft: { configurable: true, value: 5 + index * 100 },
      offsetWidth: { configurable: true, value: 100 },
    }),
  );
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    rail.scrollLeft = options.left ?? 0;
    fireEvent.scroll(rail);
  });
  Object.defineProperty(rail, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  fireEvent(window, new Event("resize"));
  expect(scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ left: 350 }),
  );
  const last = buttons[5];
  expect(last.offsetLeft + last.offsetWidth).toBeLessThanOrEqual(
    rail.scrollLeft + rail.clientWidth,
  );
  expect(screen.queryByRole("button", { name: "পরের বোতাম দেখুন" })).toBeNull();
  expect(screen.getByRole("button", { name: "আগের বোতাম দেখুন" })).toBeTruthy();
  fireEvent.click(within(rail).getByRole("button", { name: "সব লেনদেন" }));
  expect(scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ left: 0 }),
  );
  expect(screen.getByRole("button", { name: "পরের বোতাম দেখুন" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "আগের বোতাম দেখুন" })).toBeNull();
  const before = screen.getByTestId("work-route").textContent;
  fireEvent.click(screen.getByRole("button", { name: "পরের বোতাম দেখুন" }));
  expect(scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ left: 195 }),
  );
  expect(screen.getByTestId("work-route").textContent).toBe(before);
  fireEvent.click(within(rail).getByRole("button", { name: "মজুরি" }));
  expect(scrollTo).toHaveBeenLastCalledWith(
    expect.objectContaining({ left: 165 }),
  );
  expect(buttons[2].offsetLeft - rail.scrollLeft).toBe(40);
});

it("shows scoped compact job previews on the labour tab and routes details away from notebook menus", async () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "door", name: "দরজা" },
      { id: "roof", name: "ছাদ" },
    ],
    people: [
      { id: "worker", name: "শাহ আলম", kind: "worker" },
      { id: "other-worker", name: "রহিম", kind: "worker" },
    ],
    contracts: [
      {
        id: "door-job",
        personId: "worker",
        workId: "door",
        title: "দরজার নকশা",
        total: 1000000,
      },
      {
        id: "house-job",
        personId: "other-worker",
        scope: "house",
        title: "রাজমিস্ত্রির কাজ",
        total: 5000000,
      },
      {
        id: "roof-job",
        personId: "worker",
        workId: "roof",
        title: "শুধু ছাদের কাজ",
        total: 2000000,
      },
    ],
    entries: [
      {
        id: "door-paid",
        kind: "payment",
        account: "labour",
        personId: "worker",
        contractId: "door-job",
        allocations: [{ workId: "door", amount: 200000 }],
        paymentParts: [{ amount: 200000 }],
      },
      {
        id: "house-paid",
        kind: "payment",
        account: "labour",
        personId: "other-worker",
        contractId: "house-job",
        allocations: [{ workId: "roof", amount: 500000 }],
        paymentParts: [{ amount: 500000 }],
      },
    ],
  });
  const before = JSON.stringify(ledger);
  context.ledger = ledger;
  const { container } = render(
    <MemoryRouter initialEntries={["/works/door?tab=labour"]}>
      <Routes>
        <Route path="/works/:workId" element={<WorkPage />} />
      </Routes>
    </MemoryRouter>,
  );
  const preview = container.querySelector<HTMLElement>(".job-preview")!;
  const tiles = preview.querySelectorAll<HTMLElement>(".job-snap-card");
  expect(tiles).toHaveLength(2);
  expect(tiles[0].textContent).toContain("শাহ আলম");
  expect(tiles[0].textContent).toContain("৳10000");
  expect(tiles[0].textContent).toContain("৳8000");
  expect(tiles[1].textContent).toContain("রহিম");
  expect(tiles[1].textContent).toContain("৳50000");
  expect(tiles[1].textContent).toContain("৳45000");
  expect(preview.textContent).not.toContain("শুধু ছাদের কাজ");
  expect(preview.textContent).not.toContain("পুরো বাড়ি");
  expect(within(preview).queryByRole("progressbar")).toBeNull();
  expect(preview.querySelector(".contract-history")).toBeNull();
  expect(preview.querySelector(".contract-card")).toBeNull();
  fireEvent.click(tiles[0]);
  const jobRoute = new URL(
    context.go.mock.calls.at(-1)?.[0] ?? "",
    "https://bari.invalid",
  );
  expect(jobRoute.pathname).toBe("/jobs/door-job");
  expect(jobRoute.searchParams.get("back")).toBe("/works/door?tab=labour");
  screen.getByRole("button", { name: "খাতার আরও কাজ" }).focus();
  await userEvent.setup().keyboard("{Enter}");
  expect(await screen.findByRole("menu")).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "মজুরির দর রাখি" })).toBeNull();
  expect(JSON.stringify(ledger)).toBe(before);
});

function renderWorksDirectory(path: string) {
  context.ledger = LedgerSchema.parse({
    works: [
      {
        id: "bn16",
        name: "খাতা ১৬",
        status: "ongoing",
        icon: "tiles",
        color: "rose",
      },
      { id: "en8", name: "ঘর 8", status: "done", icon: "door", color: "blue" },
      {
        id: "all-rods",
        name: "All rods",
        status: "planned",
        icon: "steel",
        color: "amber",
      },
    ],
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <WorksPage />
      <WorkRouteLocation />
    </MemoryRouter>,
  );
}

it("restores notebook search and status from the URL and preserves other filters while switching chips", () => {
  renderWorksDirectory("/works?status=done&q=8&from=2026-01-01");
  const filters = screen.getByRole("group", { name: "কাজের অবস্থা" });
  expect(
    within(filters).getByRole("button", { name: "শেষ", pressed: true }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("textbox", { name: "খাতা খুঁজুন" }) as HTMLInputElement)
      .value,
  ).toBe("8");
  expect(screen.getByRole("heading", { name: "ঘর 8" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "খাতা খুঁজুন" }), {
    target: { value: "১৬" },
  });
  expect(screen.queryByRole("heading", { name: "ঘর 8" })).toBeNull();
  expect(
    within(filters).getByRole("button", { name: "শেষ" }).querySelector("small"),
  ).toBeNull();
  fireEvent.click(within(filters).getByRole("button", { name: "চলছে" }));
  expect(screen.getByRole("heading", { name: "খাতা ১৬" })).toBeTruthy();
  let params = new URL(
    screen.getByTestId("work-route").textContent ?? "",
    "https://bari.invalid",
  ).searchParams;
  expect(Object.fromEntries(params)).toEqual({
    status: "ongoing",
    q: "১৬",
    from: "2026-01-01",
  });
  fireEvent.click(screen.getByRole("button", { name: "খোঁজা মুছুন" }));
  params = new URL(
    screen.getByTestId("work-route").textContent ?? "",
    "https://bari.invalid",
  ).searchParams;
  expect(params.has("q")).toBe(false);
  expect(params.get("status")).toBe("ongoing");
  fireEvent.click(within(filters).getByRole("button", { name: "সব" }));
  params = new URL(
    screen.getByTestId("work-route").textContent ?? "",
    "https://bari.invalid",
  ).searchParams;
  expect(Object.fromEntries(params)).toEqual({ from: "2026-01-01" });
  expect(screen.getByRole("heading", { name: "All rods" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "নতুন খাতা" }));
  expect(context.entity).toHaveBeenCalledWith("work");
});

it("treats an invalid status as all and retains the literal search word all", () => {
  renderWorksDirectory("/works?status=unknown&q=all");
  const filters = screen.getByRole("group", { name: "কাজের অবস্থা" });
  expect(
    within(filters).getByRole("button", { name: "সব", pressed: true }),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "All rods" })).toBeTruthy();
  expect(
    (screen.getByRole("textbox", { name: "খাতা খুঁজুন" }) as HTMLInputElement)
      .value,
  ).toBe("all");
  fireEvent.click(screen.getByRole("button", { name: "খোঁজা মুছুন" }));
  fireEvent.change(screen.getByRole("textbox", { name: "খাতা খুঁজুন" }), {
    target: { value: "all" },
  });
  expect(screen.getByRole("heading", { name: "All rods" })).toBeTruthy();
  fireEvent.click(within(filters).getByRole("button", { name: "চলছে" }));
  expect(
    (screen.getByRole("textbox", { name: "খাতা খুঁজুন" }) as HTMLInputElement)
      .value,
  ).toBe("all");
});

it("clears an empty filtered result without dropping unrelated URL state or changing notebook records", () => {
  const { container } = renderWorksDirectory(
    "/works?status=done&q=missing&from=2026-01-01",
  );
  const before = JSON.stringify(context.ledger);
  expect(container.querySelectorAll(".work-notebook-card")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "সব খাতা দেখুন" }));
  expect(container.querySelectorAll(".work-notebook-card")).toHaveLength(3);
  const params = new URL(
    screen.getByTestId("work-route").textContent ?? "",
    "https://bari.invalid",
  ).searchParams;
  expect(Object.fromEntries(params)).toEqual({ from: "2026-01-01" });
  expect(JSON.stringify(context.ledger)).toBe(before);
});

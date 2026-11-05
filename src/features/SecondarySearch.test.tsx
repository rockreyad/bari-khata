// @vitest-environment jsdom
import { Suspense, type SelectHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BrowserRouter,
  MemoryRouter,
  useLocation,
  useNavigate,
} from "react-router";
import { LedgerSchema } from "../domain/model";
import { JobsPage } from "./jobs/JobPages";
import { TimelinePage } from "./history/TimelinePage";

const context = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  detail: vi.fn(),
  save: vi.fn(),
  entity: vi.fn(),
  base: "",
}));
vi.mock("../app/NotebookProvider", () => ({ useNotebook: () => context }));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string> = {}) =>
      text.replace(/{{(\w+)}}/g, (_, key: string) => values[key] ?? ""),
    money: (value: number) => `৳${value / 100}`,
    date: String,
    number: String,
    formatDigits: String,
  }),
}));
vi.mock("../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fixture() {
  return LedgerSchema.parse({
    works: [{ id: "one", name: "ভিত্তি" }],
    people: [{ id: "worker", name: "শাহ আলম", kind: "worker" }],
    contracts: [
      {
        id: "cement",
        title: "সিমেন্ট কাজ",
        personId: "worker",
        workId: "one",
        total: 10000,
        status: "ongoing",
      },
      {
        id: "karim",
        title: "করিম কাজ",
        personId: "worker",
        workId: "one",
        total: 10000,
        status: "ongoing",
      },
      {
        id: "all",
        title: "All supplies",
        personId: "worker",
        workId: "one",
        total: 10000,
        status: "planned",
      },
    ],
    entries: Array.from({ length: 45 }, (_, index) => ({
      id: `entry-${index}`,
      kind: "expense",
      createdAt: new Date(
        Date.UTC(2026, 10, 3, 10) - index * 1000,
      ).toISOString(),
      note: `wall repair ${index}`,
      lines: [
        {
          id: `line-${index}`,
          label: `সিমেন্ট ${index}`,
          workId: "one",
          amount: 100,
        },
      ],
    })),
  });
}
function Probe({ external = "বাইরের খোঁজ" }: { external?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="route" data-key={location.key}>
        {location.pathname + location.search}
      </output>
      <button
        onClick={() => {
          const next = new URLSearchParams(location.search);
          next.set("q", external);
          navigate({ search: next.toString() });
        }}
      >
        External search
      </button>
      <button
        onClick={() => {
          const next = new URLSearchParams(location.search);
          next.delete("q");
          navigate({ search: next.toString() });
        }}
      >
        External clear
      </button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>
  );
}
const route = () =>
  new URL(screen.getByTestId("route").textContent!, "https://bari.invalid");
const key = () => screen.getByTestId("route").getAttribute("data-key");
const cases = [
  {
    name: "jobs",
    Page: JobsPage,
    path: "/works",
    label: "কাজ খুঁজুন",
    first: "করিম",
    final: "সিমেন্ট",
    preedit: "si",
    filters: { person: "worker", work: "one", status: "ongoing", keep: "yes" },
    action: /^চলছে/,
  },
  {
    name: "timeline",
    Page: TimelinePage,
    path: "/timeline",
    label: "টাইমলাইনে খুঁজুন",
    first: "wall",
    final: "সিমেন্ট",
    preedit: "si",
    filters: { type: "money", keep: "yes" },
    action: /^সব ঘটনা$/,
  },
] as const;

describe.each(cases)("$name secondary search", (testCase) => {
  function mount() {
    context.ledger = fixture();
    const params = new URLSearchParams({
      ...testCase.filters,
      q: testCase.first,
    });
    render(
      <MemoryRouter initialEntries={[`${testCase.path}?${params}`]}>
        <testCase.Page />
        <Probe />
      </MemoryRouter>,
    );
    return screen.getByRole("textbox", {
      name: testCase.label,
    }) as HTMLInputElement;
  }
  it("keeps preedit local, commits the whole value once and leaves financial data untouched", () => {
    const input = mount();
    const before = JSON.stringify(context.ledger);
    const initial = key();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: testCase.preedit } });
    expect(input.value).toBe(testCase.preedit);
    expect(route().searchParams.get("q")).toBe(testCase.first);
    expect(key()).toBe(initial);
    fireEvent.compositionEnd(input, {
      data: "শেষ অক্ষর",
      target: { value: testCase.final },
    });
    expect(input.value).toBe(testCase.final);
    expect(Object.fromEntries(route().searchParams)).toEqual({
      ...testCase.filters,
      q: testCase.final,
    });
    const committed = key();
    fireEvent.input(input, {
      isComposing: false,
      inputType: "insertCompositionText",
      target: { value: testCase.final },
    });
    expect(key()).toBe(committed);
    expect(JSON.stringify(context.ledger)).toBe(before);
    expect(context.save).not.toHaveBeenCalled();
    expect(context.detail).not.toHaveBeenCalled();
  });
  it("commits native-only composition on blur and retains it when changing a filter", () => {
    const input = mount();
    fireEvent.input(input, {
      isComposing: true,
      inputType: "insertCompositionText",
      target: { value: testCase.preedit },
    });
    expect(route().searchParams.get("q")).toBe(testCase.first);
    fireEvent.blur(input, { target: { value: testCase.final } });
    fireEvent.click(screen.getByRole("button", { name: testCase.action }));
    expect(route().searchParams.get("q")).toBe(testCase.final);
    expect(route().searchParams.get("keep")).toBe("yes");
    fireEvent.compositionEnd(input, { target: { value: testCase.final } });
    expect(input.value).toBe(testCase.final);
  });
  it("preserves pasted replacements and an empty query without changing the other filters", async () => {
    const input = mount();
    const user = userEvent.setup();
    await user.click(input);
    input.setSelectionRange(0, input.value.length);
    await user.paste("সিমেন্ট ১৬");
    expect(input.value).toBe("সিমেন্ট ১৬");
    expect(route().searchParams.get("q")).toBe("সিমেন্ট ১৬");
    await user.clear(input);
    expect(input.value).toBe("");
    expect(Object.fromEntries(route().searchParams)).toEqual(testCase.filters);
  });
  it("restores external URL navigation and browser history while rejecting cancelled late composition", () => {
    const input = mount();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: testCase.preedit } });
    fireEvent.click(screen.getByRole("button", { name: "External search" }));
    expect(input.value).toBe("বাইরের খোঁজ");
    fireEvent.compositionEnd(input, { target: { value: testCase.final } });
    expect(input.value).toBe("বাইরের খোঁজ");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(input.value).toBe(testCase.first);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(input.value).toBe("বাইরের খোঁজ");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: testCase.preedit } });
    fireEvent.click(screen.getByRole("button", { name: "External clear" }));
    fireEvent.compositionEnd(input, { target: { value: testCase.final } });
    expect(input.value).toBe("");
    expect(route().searchParams.has("q")).toBe(false);
  });
  it("keeps the just-blurred query when a BrowserRouter filter transition renders later", async () => {
    context.ledger = fixture();
    const original = window.location.href;
    window.history.replaceState(null, "", `${testCase.path}?keep=yes`);
    let ready = false;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    function Gate() {
      if (
        new URLSearchParams(useLocation().search).get("q") === testCase.final &&
        !ready
      )
        throw waiting;
      return null;
    }
    try {
      render(
        <BrowserRouter>
          <Suspense fallback={<p>Waiting</p>}>
            <testCase.Page />
            <Probe />
            <Gate />
          </Suspense>
        </BrowserRouter>,
      );
      const input = screen.getByRole("textbox", {
        name: testCase.label,
      }) as HTMLInputElement;
      await userEvent.click(input);
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: testCase.final } });
      await userEvent.click(
        screen.getByRole("button", { name: testCase.action }),
      );
      expect(new URL(window.location.href).searchParams.get("q")).toBe(
        testCase.final,
      );
      await act(async () => {
        ready = true;
        release();
      });
      expect(route().searchParams.get("q")).toBe(testCase.final);
      expect(route().searchParams.get("keep")).toBe("yes");
      expect(input.value).toBe(testCase.final);
    } finally {
      await act(async () => {
        ready = true;
        release();
      });
      window.history.replaceState(null, "", original);
    }
  });
});

it("treats all as a literal job query and clamps only committed text to the existing 200-character limit", () => {
  context.ledger = fixture();
  render(
    <MemoryRouter initialEntries={["/works?status=planned&keep=yes"]}>
      <JobsPage />
      <Probe />
    </MemoryRouter>,
  );
  const input = screen.getByRole("textbox", {
    name: "কাজ খুঁজুন",
  }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "all" } });
  expect(route().searchParams.get("q")).toBe("all");
  expect(document.querySelectorAll(".job-snap-card")).toHaveLength(1);
  const long = "স".repeat(210);
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: long } });
  expect(input.value).toBe(long);
  expect(route().searchParams.get("q")).toBe("all");
  fireEvent.compositionEnd(input, { target: { value: long } });
  expect(input.value).toBe(long.slice(0, 200));
  expect(route().searchParams.get("q")).toBe(long.slice(0, 200));
});

it("resets job filters during preedit without letting the final keyboard event restore the cleared text", () => {
  context.ledger = fixture();
  render(
    <MemoryRouter
      initialEntries={["/works?status=planned&person=worker&keep=yes"]}
    >
      <JobsPage />
      <Probe />
    </MemoryRouter>,
  );
  const input = screen.getByRole("textbox", {
    name: "কাজ খুঁজুন",
  }) as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "si" } });
  fireEvent.click(screen.getByRole("button", { name: "বাছাই মুছি" }));
  fireEvent.compositionEnd(input, { target: { value: "সিমেন্ট" } });
  expect(input.value).toBe("");
  expect(Object.fromEntries(route().searchParams)).toEqual({ keep: "yes" });
});

it("preserves a blurred query through timeline pagination before its query transition renders", async () => {
  context.ledger = fixture();
  const original = window.location.href;
  window.history.replaceState(null, "", "/timeline?type=money&keep=yes");
  let ready = false;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  function Gate() {
    if (
      new URLSearchParams(useLocation().search).get("q") === "সিমেন্ট" &&
      !ready
    )
      throw waiting;
    return null;
  }
  try {
    render(
      <BrowserRouter>
        <Suspense fallback={<p>Waiting</p>}>
          <TimelinePage />
          <Probe />
          <Gate />
        </Suspense>
      </BrowserRouter>,
    );
    const input = screen.getByRole("textbox", {
      name: "টাইমলাইনে খুঁজুন",
    }) as HTMLInputElement;
    await userEvent.click(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "সিমেন্ট" } });
    await userEvent.click(screen.getByRole("button", { name: "পরের পাতা" }));
    const browser = new URL(window.location.href).searchParams;
    expect(browser.get("q")).toBe("সিমেন্ট");
    expect(browser.get("page")).toBe("2");
    await act(async () => {
      ready = true;
      release();
    });
    expect(route().searchParams.get("q")).toBe("সিমেন্ট");
    expect(route().searchParams.get("page")).toBe("2");
    expect(document.querySelectorAll(".timeline-event")).toHaveLength(5);
  } finally {
    await act(async () => {
      ready = true;
      release();
    });
    window.history.replaceState(null, "", original);
  }
});

// @vitest-environment jsdom
import { Suspense } from "react";
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
import { PeoplePage } from "./people/PeoplePage";
import { WorksPage } from "./works/WorksPages";

const context = vi.hoisted(() => ({
  ledger: null as unknown,
  go: vi.fn(),
  entity: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...context, mode: "demo" }),
}));
vi.mock("./people/usePeopleRoleTabs", () => ({
  usePeopleRoleTabs: () => ({
    keys: ["craftsperson", "supplier"],
    ready: true,
    saving: false,
    error: "",
    saveKeys: vi.fn(),
    retry: vi.fn(),
  }),
}));
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    language: "bn",
    money: (value: number) => `৳${value / 100}`,
    number: String,
    formatDigits: String,
    date: String,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const cases = [
  {
    name: "people",
    Page: PeoplePage,
    path: "/parties",
    label: "নাম বা নম্বর খুঁজুন",
    clear: "খোঁজ মুছুন",
    first: "করিম",
    final: "শাহ",
    preedit: "sha",
    filters: { type: "worker", role: "মিস্ত্রি", status: "due", keep: "yes" },
    rows: ".contact-row-name > strong",
    full: "শাহ আলম",
    replacement: "করিম",
    replaced: "করিম আলম",
  },
  {
    name: "notebooks",
    Page: WorksPage,
    path: "/sectors",
    label: "খাতা খুঁজুন",
    clear: "খোঁজা মুছুন",
    first: "দরজা",
    final: "সিমেন্ট",
    preedit: "si",
    filters: { status: "ongoing", from: "2026-01-01", keep: "yes" },
    rows: ".work-notebook-card h3",
    full: "সিমেন্ট খাতা",
    replacement: "দরজা",
    replaced: "দরজা খাতা",
  },
] as const;

function fixture() {
  return LedgerSchema.parse({
    works: [
      { id: "cement", name: "সিমেন্ট খাতা", status: "ongoing" },
      { id: "door", name: "দরজা খাতা", status: "ongoing" },
      { id: "all", name: "All supplies", status: "planned" },
    ],
    people: [
      { id: "shah", name: "শাহ আলম", kind: "worker", role: "মিস্ত্রি" },
      { id: "karim", name: "করিম আলম", kind: "worker", role: "মিস্ত্রি" },
      { id: "all", name: "All supplies", kind: "shop" },
    ],
    entries: ["shah", "karim"].map((personId) => ({
      id: `bill-${personId}`,
      kind: "expense",
      account: "labour",
      personId,
      lines: [
        {
          id: `line-${personId}`,
          workId: "cement",
          label: "মজুরি",
          costType: "labour",
          amount: 10000,
        },
      ],
    })),
  });
}

function RouteProbe({ final }: { final: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="route" data-navigation-key={location.key}>
        {location.pathname + location.search}
      </output>
      <button
        onClick={() => {
          const params = new URLSearchParams(location.search);
          params.set("q", final);
          navigate({ search: params.toString() });
        }}
      >
        External search
      </button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>
  );
}
const route = () =>
  new URL(screen.getByTestId("route").textContent!, "https://bari.invalid");
const key = () =>
  screen.getByTestId("route").getAttribute("data-navigation-key");

describe.each(cases)("$name search", (testCase) => {
  function mount(query: string | null = testCase.first, filtered = true) {
    context.ledger = fixture();
    const params = new URLSearchParams(filtered ? testCase.filters : {});
    if (query !== null) params.set("q", query);
    const view = render(
      <MemoryRouter initialEntries={[`${testCase.path}?${params}`]}>
        <testCase.Page />
        <RouteProbe final={testCase.final} />
      </MemoryRouter>,
    );
    return {
      ...view,
      input: screen.getByRole("textbox", {
        name: testCase.label,
      }) as HTMLInputElement,
    };
  }
  const names = () =>
    [...document.querySelectorAll(testCase.rows)].map((row) => row.textContent);

  it("keeps phonetic preedit local and commits the complete DOM value once", () => {
    const { input } = mount();
    const before = JSON.stringify(context.ledger);
    const initialKey = key();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: testCase.preedit } });
    expect(input.value).toBe(testCase.preedit);
    expect(route().searchParams.get("q")).toBe(testCase.first);
    expect(key()).toBe(initialKey);
    expect(names().join(" ")).toContain(testCase.first);
    fireEvent.compositionEnd(input, {
      data: "শেষ অক্ষর",
      target: { value: testCase.final },
    });
    expect(input.value).toBe(testCase.final);
    expect(Object.fromEntries(route().searchParams)).toEqual({
      ...testCase.filters,
      q: testCase.final,
    });
    expect(names().join(" ")).toContain(testCase.final);
    const committedKey = key();
    fireEvent.input(input, {
      inputType: "insertCompositionText",
      isComposing: false,
      target: { value: testCase.final },
    });
    expect(key()).toBe(committedKey);
    expect(JSON.stringify(context.ledger)).toBe(before);
    expect(context.save).not.toHaveBeenCalled();
  });

  it("recognizes native composing input without a start event and commits on blur", () => {
    const { input } = mount();
    fireEvent.input(input, {
      inputType: "insertCompositionText",
      isComposing: true,
      target: { value: testCase.preedit },
    });
    expect(input.value).toBe(testCase.preedit);
    expect(route().searchParams.get("q")).toBe(testCase.first);
    fireEvent.blur(input, { target: { value: testCase.final } });
    expect(route().searchParams.get("q")).toBe(testCase.final);
    const committedKey = key();
    fireEvent.compositionEnd(input, { data: "শেষ অক্ষর" });
    expect(key()).toBe(committedKey);
  });

  it("clears an unfinished word and ignores late composition end/input without losing focus or filters", async () => {
    const { input } = mount(null);
    await userEvent.click(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: testCase.preedit } });
    await userEvent.click(screen.getByRole("button", { name: testCase.clear }));
    fireEvent.compositionEnd(input, {
      data: "শেষ অক্ষর",
      target: { value: testCase.final },
    });
    fireEvent.input(input, {
      inputType: "insertCompositionText",
      isComposing: false,
      target: { value: testCase.final },
    });
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(Object.fromEntries(route().searchParams)).toEqual(testCase.filters);
    await userEvent.type(input, testCase.final);
    expect(route().searchParams.get("q")).toBe(testCase.final);
  });

  it("restores external back/forward queries and cancels a pending composition on back", async () => {
    const { input } = mount();
    fireEvent.click(screen.getByRole("button", { name: "External search" }));
    expect(input.value).toBe(testCase.final);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: testCase.preedit } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(input.value).toBe(testCase.first);
    expect(route().searchParams.get("q")).toBe(testCase.first);
    fireEvent.compositionEnd(input, { target: { value: testCase.final } });
    expect(input.value).toBe(testCase.first);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(input.value).toBe(testCase.final);
    expect(names().join(" ")).toContain(testCase.final);
    expect(Object.fromEntries(route().searchParams)).toEqual({
      ...testCase.filters,
      q: testCase.final,
    });
  });

  it("keeps literal all, pasted Bengali and selection replacement usable", async () => {
    const { input } = mount(null, false);
    const user = userEvent.setup();
    await user.type(input, "all");
    expect(input.value).toBe("all");
    expect(route().searchParams.get("q")).toBe("all");
    expect(names()).toEqual(["All supplies"]);
    input.setSelectionRange(0, input.value.length);
    await user.paste(testCase.full);
    expect(input.value).toBe(testCase.full);
    expect(names()).toEqual([testCase.full]);
    input.setSelectionRange(0, testCase.final.length);
    await user.paste(testCase.replacement);
    expect(input.value).toBe(testCase.replaced);
    expect(route().searchParams.get("q")).toBe(testCase.replaced);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(testCase.replacement.length);
    expect(input.selectionEnd).toBe(testCase.replacement.length);
    expect(names()).toEqual([testCase.replaced]);
  });

  it("honors an external query change during composition instead of restoring stale keyboard text", () => {
    const { input } = mount();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: testCase.preedit } });
    fireEvent.click(screen.getByRole("button", { name: "External search" }));
    expect(input.value).toBe(testCase.final);
    fireEvent.compositionEnd(input, { target: { value: testCase.preedit } });
    expect(input.value).toBe(testCase.final);
    expect(route().searchParams.get("q")).toBe(testCase.final);
    expect(names().join(" ")).toContain(testCase.final);
  });

  it("keeps a newer composed value when an older BrowserRouter search transition resolves", async () => {
    context.ledger = fixture();
    const originalURL = window.location.href;
    window.history.replaceState(null, "", testCase.path);
    let earlierReady = false;
    let finalReady = false;
    let resolveEarlier!: () => void;
    let resolveFinal!: () => void;
    const earlier = new Promise<void>((resolve) => {
      resolveEarlier = resolve;
    });
    const final = new Promise<void>((resolve) => {
      resolveFinal = resolve;
    });
    function Gate() {
      const query = new URLSearchParams(useLocation().search).get("q");
      if (query === "s" && !earlierReady) throw earlier;
      if (query === testCase.final && !finalReady) throw final;
      return null;
    }
    try {
      render(
        <BrowserRouter>
          <Suspense fallback={<p>Loading search</p>}>
            <testCase.Page />
            <RouteProbe final={testCase.final} />
            <Gate />
          </Suspense>
        </BrowserRouter>,
      );
      const input = screen.getByRole("textbox", {
        name: testCase.label,
      }) as HTMLInputElement;
      await userEvent.click(input);
      fireEvent.change(input, { target: { value: "s" } });
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: testCase.preedit } });
      fireEvent.compositionEnd(input, { target: { value: testCase.final } });
      await act(async () => {
        earlierReady = true;
        resolveEarlier();
      });
      expect(input.value).toBe(testCase.final);
      await act(async () => {
        finalReady = true;
        resolveFinal();
      });
      expect(input.value).toBe(testCase.final);
      expect(document.activeElement).toBe(input);
      expect(route().searchParams.get("q")).toBe(testCase.final);
    } finally {
      window.history.replaceState(null, "", originalURL);
    }
  });
});

it("removes only the notebook directory's all-works shortcut", () => {
  context.ledger = fixture();
  const view = render(
    <MemoryRouter>
      <WorksPage />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("button", { name: "সব কাজ" })).toBeNull();
  view.unmount();
  render(
    <MemoryRouter>
      <PeoplePage />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "সব কাজ" })).toBeTruthy();
});

it("resets a notebook's unfinished local search when showing all notebooks even if q was empty", () => {
  context.ledger = fixture();
  render(
    <MemoryRouter initialEntries={["/sectors?status=done&keep=yes"]}>
      <WorksPage />
      <RouteProbe final="সিমেন্ট" />
    </MemoryRouter>,
  );
  const input = screen.getByRole("textbox", {
    name: "খাতা খুঁজুন",
  }) as HTMLInputElement;
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "si" } });
  fireEvent.click(screen.getByRole("button", { name: "সব খাতা দেখুন" }));
  fireEvent.compositionEnd(input, { target: { value: "সিমেন্ট" } });
  expect(input.value).toBe("");
  expect(Object.fromEntries(route().searchParams)).toEqual({ keep: "yes" });
  expect(document.querySelectorAll(".work-notebook-card")).toHaveLength(3);
});

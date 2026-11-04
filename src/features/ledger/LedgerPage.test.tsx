// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { LedgerPage } from "./LedgerPage";

const state = vi.hoisted(() => ({ ledger: null as unknown, detail: vi.fn() }));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    ledger: state.ledger as Ledger,
    add: vi.fn(),
    go: vi.fn(),
    detail: state.detail,
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: String,
    language: "bn",
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    number: String,
    date: (value: string | null) => value ?? "—",
  }),
}));

afterEach(() => {
  cleanup();
  state.detail.mockClear();
});

function fixture(count = 65) {
  return LedgerSchema.parse({
    works: [{ id: "w", name: "কাজ" }],
    entries: Array.from({ length: count }, (_, index) => ({
      id: `e${String(index).padStart(3, "0")}`,
      kind: "expense",
      date: "2026-11-01",
      lines: [
        {
          id: `l${index}`,
          workId: "w",
          label: `${index < 35 ? "সিমেন্ট" : "বালি"} ${index + 1}`,
          amount: 10000,
        },
      ],
    })),
  });
}

function Location() {
  const location = useLocation();
  return (
    <output data-testid="location" data-navigation-key={location.key}>
      {location.search}
    </output>
  );
}

function SearchNavigation() {
  const navigate = useNavigate();
  return (
    <>
      <button
        onClick={() => navigate("/ledger?q=বালি&work=w&order=oldest&page=2")}
      >
        Open another search
      </button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>
  );
}

function open(path = "/ledger?order=oldest", navigation = false) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LedgerPage />
      <Location />
      {navigation ? <SearchNavigation /> : null}
    </MemoryRouter>,
  );
}

describe("history load more", () => {
  it.each([0, 2, 30])(
    "hides pagination and load more for %i entries",
    (count) => {
      state.ledger = fixture(count);
      const { container } = open();
      expect(container.querySelectorAll(".history-row")).toHaveLength(count);
      expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
      expect(container.querySelector(".list-load-more")).toBeNull();
      expect(screen.queryByRole("navigation")).toBeNull();
    },
  );

  it("appends without replacing previous rows or scrolling to the top, then hides the button", async () => {
    state.ledger = fixture();
    const scroll = vi.spyOn(window, "scrollTo");
    const user = userEvent.setup();
    const { container } = open();
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    const first = container.querySelector(".history-row");
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(60);
    expect(container.querySelector(".history-row")).toBe(first);
    expect(screen.getByTestId("location").textContent).toContain("page=2");
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(65);
    expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
    expect(container.querySelector(".list-load-more")).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
    await user.click(first!);
    expect(state.detail).toHaveBeenCalledWith("e000");
  });

  it("resets appended rows when searching or changing chronology", async () => {
    state.ledger = fixture();
    const user = userEvent.setup();
    const { container } = open("/ledger?order=oldest&page=2");
    expect(container.querySelectorAll(".history-row")).toHaveLength(60);
    await user.type(
      screen.getByRole("searchbox", { name: "হিসাব খুঁজুন" }),
      "সিমেন্ট",
    );
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    expect(screen.getByTestId("location").textContent).not.toContain("page=");
    await user.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(35);
    await user.click(screen.getByRole("button", { name: "শুরু থেকে" }));
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    await user.type(
      screen.getByRole("searchbox", { name: "হিসাব খুঁজুন" }),
      "নেই",
    );
    expect(container.querySelectorAll(".history-row")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  });
});

it("shows the legacy driver's bill and current payment when opening its full history link", async () => {
  state.ledger = LedgerSchema.parse({
    works: [{ id: "door", name: "দরজা" }],
    people: [{ id: "driver", name: "রনি", kind: "driver" }],
    entries: [
      {
        id: "trip",
        kind: "expense",
        account: "materials",
        personId: "driver",
        date: "2026-11-01",
        lines: [
          {
            id: "t",
            workId: "door",
            label: "পুরোনো ভ্যানের বিল",
            costType: "transport",
            amount: 100000,
          },
        ],
      },
      {
        id: "paid",
        kind: "payment",
        account: "other",
        personId: "driver",
        date: "2026-11-02",
        allocations: [{ workId: "door", amount: 100000 }],
        paymentParts: [{ amount: 100000 }],
      },
    ],
  });
  const { container } = open(
    "/ledger?person=driver&account=other&work=door&order=oldest",
  );
  const rows = [...container.querySelectorAll(".history-row")];
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain("পুরোনো ভ্যানের বিল");
  expect(rows[1].textContent).toContain("টাকা দিয়েছি");
  expect(rows[1].textContent).toContain("৳1000");
  await userEvent.click(rows[0]);
  expect(state.detail).toHaveBeenCalledWith("trip");
});

it("keeps Bengali composition out of navigation and results until the word is complete", () => {
  state.ledger = fixture();
  const { container } = open("/ledger?q=বালি&work=w&order=oldest&page=2");
  const input = screen.getByRole("searchbox", { name: "হিসাব খুঁজুন" });
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "সিমে" } });

  expect((input as HTMLInputElement).value).toBe("সিমে");
  const composing = new URLSearchParams(
    screen.getByTestId("location").textContent ?? "",
  );
  expect(composing.get("q")).toBe("বালি");
  expect(composing.get("page")).toBe("2");
  expect(container.querySelector(".history-row")?.textContent).toContain(
    "বালি",
  );

  fireEvent.compositionEnd(input, {
    data: "ন্ট",
    target: { value: "সিমেন্ট" },
  });

  expect((input as HTMLInputElement).value).toBe("সিমেন্ট");
  const committed = new URLSearchParams(
    screen.getByTestId("location").textContent ?? "",
  );
  expect(committed.get("q")).toBe("সিমেন্ট");
  expect(committed.get("work")).toBe("w");
  expect(committed.get("order")).toBe("oldest");
  expect(committed.has("page")).toBe(false);
  expect(container.querySelectorAll(".history-row")).toHaveLength(30);
  expect(container.querySelector(".history-row")?.textContent).toContain(
    "সিমেন্ট",
  );
  const navigation = screen
    .getByTestId("location")
    .getAttribute("data-navigation-key");
  fireEvent.input(input, {
    data: "সিমেন্ট",
    inputType: "insertCompositionText",
    isComposing: false,
    target: { value: "সিমেন্ট" },
  });
  expect((input as HTMLInputElement).value).toBe("সিমেন্ট");
  expect(
    new URLSearchParams(screen.getByTestId("location").textContent ?? "").get(
      "q",
    ),
  ).toBe("সিমেন্ট");
  expect(
    screen.getByTestId("location").getAttribute("data-navigation-key"),
  ).toBe(navigation);
});

it.each([false, true])(
  "keeps the query cleared when the keyboard finishes after clearing (already committed: %s)",
  async (committed) => {
    state.ledger = fixture();
    const before = structuredClone(state.ledger);
    const user = userEvent.setup();
    const { container } = open("/ledger?work=w&order=oldest");
    const input = screen.getByRole("searchbox", {
      name: "হিসাব খুঁজুন",
    }) as HTMLInputElement;
    await user.click(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "সিমে" } });
    if (committed)
      fireEvent.compositionEnd(input, {
        data: "ন্ট",
        target: { value: "সিমেন্ট" },
      });
    await user.click(screen.getByRole("button", { name: "খোঁজ মুছুন" }));
    fireEvent.compositionEnd(input, { data: "সিমেন্ট" });
    fireEvent.input(input, {
      data: null,
      inputType: "deleteCompositionText",
      isComposing: false,
      target: { value: "" },
    });

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    const params = new URLSearchParams(
      screen.getByTestId("location").textContent ?? "",
    );
    expect(params.has("q")).toBe(false);
    expect(params.get("work")).toBe("w");
    expect(params.get("order")).toBe("oldest");
    expect(container.querySelectorAll(".history-row")).toHaveLength(30);
    expect(state.ledger).toEqual(before);
  },
);

it("preserves Bengali selection edits and focus while filtering the matching entries", async () => {
  const ledger = fixture(3);
  ledger.entries[0].lines[0].label = "লাল বালু";
  ledger.entries[1].lines[0].label = "সাদা বালু";
  ledger.entries[2].lines[0].label = "ইট";
  state.ledger = ledger;
  const user = userEvent.setup();
  const { container } = open("/ledger?q=লাল বালু&work=w&order=oldest");
  const input = screen.getByRole("searchbox", {
    name: "হিসাব খুঁজুন",
  }) as HTMLInputElement;
  expect(container.querySelectorAll(".history-row")).toHaveLength(1);

  await user.click(input);
  input.setSelectionRange(0, "লাল".length);
  await user.paste("সাদা");
  expect(input.value).toBe("সাদা বালু");
  expect(input.selectionStart).toBe("সাদা".length);
  expect(document.activeElement).toBe(input);
  expect(container.querySelectorAll(".history-row")).toHaveLength(1);
  expect(container.querySelector(".history-row")?.textContent).toContain(
    "সাদা বালু",
  );

  input.setSelectionRange(0, "সাদা ".length);
  await user.keyboard("{Backspace}");
  expect(input.value).toBe("বালু");
  expect(input.selectionStart).toBe(0);
  expect(document.activeElement).toBe(input);
  const params = new URLSearchParams(
    screen.getByTestId("location").textContent ?? "",
  );
  expect(params.get("q")).toBe("বালু");
  expect(params.get("work")).toBe("w");
  expect(container.querySelectorAll(".history-row")).toHaveLength(2);
});

it("follows URL navigation and clears only the query without losing search focus", async () => {
  state.ledger = fixture();
  const user = userEvent.setup();
  const { container } = open(
    "/ledger?q=সিমেন্ট&work=w&order=newest&page=2",
    true,
  );
  const input = screen.getByRole("searchbox", {
    name: "হিসাব খুঁজুন",
  }) as HTMLInputElement;
  expect(input.value).toBe("সিমেন্ট");
  expect(container.querySelectorAll(".history-row")).toHaveLength(35);

  await user.click(screen.getByRole("button", { name: "Open another search" }));
  expect(input.value).toBe("বালি");
  expect(container.querySelectorAll(".history-row")).toHaveLength(30);
  expect(container.querySelector(".history-row")?.textContent).toContain(
    "বালি",
  );
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(input.value).toBe("সিমেন্ট");
  expect(container.querySelectorAll(".history-row")).toHaveLength(35);

  await user.click(screen.getByRole("button", { name: "খোঁজ মুছুন" }));
  expect(input.value).toBe("");
  expect(document.activeElement).toBe(input);
  const cleared = new URLSearchParams(
    screen.getByTestId("location").textContent ?? "",
  );
  expect(cleared.has("q")).toBe(false);
  expect(cleared.has("page")).toBe(false);
  expect(cleared.get("work")).toBe("w");
  expect(cleared.get("order")).toBe("newest");
  expect(container.querySelectorAll(".history-row")).toHaveLength(30);
  await user.click(screen.getByRole("button", { name: "Forward" }));
  expect(input.value).toBe("বালি");
  expect(container.querySelectorAll(".history-row")).toHaveLength(30);
});

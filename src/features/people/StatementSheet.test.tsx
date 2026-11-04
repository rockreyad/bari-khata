// @vitest-environment jsdom
import { File as NodeFile } from "node:buffer";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { StatementSheet } from "./StatementSheet";

const mocked = vi.hoisted(() => ({
  ledger: null as Ledger | null,
  notify: vi.fn(),
  save: vi.fn(),
  statement: vi.fn(),
  link: vi.fn(),
  canShare: vi.fn(),
  share: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ledger: mocked.ledger, notify: mocked.notify }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: String,
    money: (value: number) => `৳${value / 100}`,
    date: (value: string | null) => value ?? "",
    formatDigits: String,
    language: "bn",
  }),
}));
vi.mock("../../components/Sheet", () => ({
  Sheet: ({
    title,
    children,
    footer,
  }: {
    title: string;
    children: ReactNode;
    footer?: ReactNode;
  }) => (
    <section role="dialog" aria-label={title}>
      <h2>{title}</h2>
      {children}
      {footer}
    </section>
  ),
}));
vi.mock("../../components/ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
}));
vi.mock("../../lib/display", async (original) => ({
  ...(await original<typeof import("../../lib/display")>()),
  saveFile: mocked.save,
}));
vi.mock("./statement", async (original) => {
  const actual = await original<typeof import("./statement")>();
  return {
    ...actual,
    contactStatement: (...args: Parameters<typeof actual.contactStatement>) => {
      mocked.statement(...args);
      return actual.contactStatement(...args);
    },
  };
});
vi.mock("../sharing/ShareLinkControls", () => ({
  ShareLinkControls: ({ scope }: { scope: unknown }) => {
    mocked.link(scope);
    return (
      <section aria-label="লিংকে হিসাব দেখাই">
        <button type="button">লিংক তৈরি করি</button>
      </section>
    );
  },
}));

const originalCanShare = Object.getOwnPropertyDescriptor(navigator, "canShare");
const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
beforeEach(() => {
  for (const value of Object.values(mocked))
    if (vi.isMockFunction(value)) value.mockReset();
  mocked.canShare.mockReturnValue(false);
  mocked.ledger = LedgerSchema.parse({
    project: { name: "নমুনা বাড়ি" },
    works: [
      { id: "tiles", name: "নমুনা টাইলস" },
      { id: "door", name: "নমুনা দরজা" },
    ],
    people: [
      { id: "worker", name: "নমুনা মিস্ত্রি", kind: "worker" },
      { id: "shop", name: "নমুনা দোকান", kind: "shop" },
    ],
    entries: [
      {
        id: "wage",
        kind: "expense",
        personId: "worker",
        account: "labour",
        date: "2026-11-01",
        note: "sample-private-wage-note",
        lines: [
          {
            id: "wage-line",
            workId: "tiles",
            costType: "labour",
            label: "নমুনা মজুরির বিল",
            amount: 50000,
          },
        ],
      },
      {
        id: "mixed-payment",
        kind: "payment",
        personId: "worker",
        account: "labour",
        date: "2026-11-02",
        note: "sample-private-other-work-note",
        allocations: [
          { workId: "tiles", amount: 10000 },
          { workId: "door", amount: 20000 },
        ],
        paymentParts: [{ method: "cash", amount: 30000 }],
      },
      {
        id: "other-contact-bill",
        kind: "expense",
        personId: "shop",
        date: "2026-11-02",
        lines: [
          {
            id: "other-contact-line",
            workId: "door",
            label: "sample-private-other-contact-item",
            amount: 90000,
          },
        ],
      },
    ],
  });
  vi.stubGlobal("File", NodeFile);
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: mocked.canShare,
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: mocked.share,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalCanShare)
    Object.defineProperty(navigator, "canShare", originalCanShare);
  else Reflect.deleteProperty(navigator, "canShare");
  if (originalShare) Object.defineProperty(navigator, "share", originalShare);
  else Reflect.deleteProperty(navigator, "share");
});

function view(workId?: string) {
  return (
    <StatementSheet
      person={mocked.ledger!.people[0]}
      account="labour"
      workId={workId}
      onClose={vi.fn()}
    />
  );
}
async function openFileOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("ফাইল পাঠাতে চাইলে"));
}
function scopeLabel(text: string) {
  return screen.getByText(
    (_content, element) =>
      element?.tagName === "SPAN" && element.textContent === text,
  );
}

it("opens a compact sharing sheet with the selected scope and closed file options", () => {
  const { container } = render(view("tiles"));
  expect(
    screen.getByRole("dialog", { name: "হিসাবের কপি পাঠাই" }),
  ).toBeTruthy();
  expect(screen.getAllByText("নমুনা মিস্ত্রি")).toHaveLength(1);
  expect(scopeLabel("মজুরির হিসাব · নমুনা টাইলস")).toBeTruthy();
  expect(mocked.link).toHaveBeenLastCalledWith({
    personId: "worker",
    account: "labour",
    workId: "tiles",
  });
  expect(screen.getByRole("button", { name: "লিংক তৈরি করি" })).toBeTruthy();
  const fileOptions = container.querySelector("details")!;
  expect(fileOptions.open).toBe(false);
  expect(
    fileOptions.contains(screen.getByRole("button", { name: "কপি নামান" })),
  ).toBe(true);
  expect(
    fileOptions.contains(screen.getByRole("button", { name: "ফাইল পাঠান" })),
  ).toBe(true);
  expect(container.querySelector(".contact-statement-totals")).toBeNull();
  expect(container.querySelector(".statement-rows")).toBeNull();
  expect(screen.queryByText("নমুনা মজুরির বিল")).toBeNull();
  expect(mocked.statement).not.toHaveBeenCalled();
  expect(mocked.save).not.toHaveBeenCalled();
});

it("shows all works for an unfiltered account and generates the scoped file only when requested", async () => {
  const user = userEvent.setup();
  render(view());
  expect(scopeLabel("মজুরির হিসাব · সব কাজ")).toBeTruthy();
  await openFileOptions(user);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "ফাইলে আমার নোটও রাখি",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(mocked.statement).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "কপি নামান" }));
  await waitFor(() => expect(mocked.save).toHaveBeenCalledTimes(1));
  const [html, name, mime] = mocked.save.mock.calls[0];
  expect(html).toContain("নমুনা মজুরির বিল");
  expect(html).not.toContain("sample-private-wage-note");
  expect(html).not.toContain("sample-private-other-contact-item");
  expect(name).toBe("নমুনা মিস্ত্রি-statement.html");
  expect(mime).toBe("text/html;charset=utf-8");
  expect(mocked.share).not.toHaveBeenCalled();
});

it("includes opted-in notes only within the requested work and resets that choice when scope changes", async () => {
  const user = userEvent.setup();
  const { rerender } = render(view("tiles"));
  await openFileOptions(user);
  await user.click(
    screen.getByRole("checkbox", { name: "ফাইলে আমার নোটও রাখি" }),
  );
  await user.click(screen.getByRole("button", { name: "কপি নামান" }));
  await waitFor(() => expect(mocked.save).toHaveBeenCalledTimes(1));
  const html = mocked.save.mock.calls[0][0];
  expect(html).toContain("sample-private-wage-note");
  expect(html).not.toContain("sample-private-other-work-note");
  expect(html).not.toContain("নমুনা দরজা");
  expect(mocked.statement).toHaveBeenLastCalledWith(
    mocked.ledger,
    mocked.ledger!.people[0],
    { account: "labour", workId: "tiles", includeNotes: true },
  );
  rerender(view("door"));
  expect(scopeLabel("মজুরির হিসাব · নমুনা দরজা")).toBeTruthy();
  await openFileOptions(user);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "ফাইলে আমার নোটও রাখি",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  expect(mocked.link).toHaveBeenLastCalledWith({
    personId: "worker",
    account: "labour",
    workId: "door",
  });
});

it("downloads a file when native sharing is unavailable", async () => {
  const user = userEvent.setup();
  render(view("tiles"));
  await openFileOptions(user);
  await user.click(screen.getByRole("button", { name: "ফাইল পাঠান" }));
  await waitFor(() => expect(mocked.save).toHaveBeenCalledTimes(1));
  expect(mocked.share).not.toHaveBeenCalled();
  expect(mocked.notify).toHaveBeenCalledWith(
    "কপি নামানো হয়েছে। ফাইলটি যাকে দরকার পাঠাতে পারবেন।",
  );
  expect(mocked.save.mock.calls[0][0]).not.toContain(
    "sample-private-wage-note",
  );
});

it("shares the scoped file, locks both file buttons while busy, and treats cancellation silently", async () => {
  let cancel!: (error: Error) => void;
  mocked.canShare.mockReturnValue(true);
  mocked.share.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        cancel = reject;
      }),
  );
  const user = userEvent.setup();
  render(view("tiles"));
  await openFileOptions(user);
  await user.click(screen.getByRole("button", { name: "ফাইল পাঠান" }));
  await waitFor(() => expect(mocked.share).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole("button", { name: "কপি নামান" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "অপেক্ষা করুন…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  const payload = mocked.share.mock.calls[0][0];
  expect(payload.title).toBe("হিসাবের কপি");
  expect(payload.files).toHaveLength(1);
  const html = await payload.files[0].text();
  expect(html).toContain("নমুনা মজুরির বিল");
  expect(html).not.toContain("নমুনা দরজা");
  expect(html).not.toContain("sample-private-wage-note");
  const aborted = new Error("cancelled");
  aborted.name = "AbortError";
  cancel(aborted);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "ফাইল পাঠান" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  expect(mocked.save).not.toHaveBeenCalled();
  expect(mocked.notify).not.toHaveBeenCalled();
});

it("reports a sharing failure without falling back to an unintended second export", async () => {
  mocked.canShare.mockReturnValue(true);
  mocked.share.mockRejectedValue(new Error("failed"));
  const user = userEvent.setup();
  render(view("tiles"));
  await openFileOptions(user);
  await user.click(screen.getByRole("button", { name: "ফাইল পাঠান" }));
  await waitFor(() =>
    expect(mocked.notify).toHaveBeenCalledWith(
      "কপি পাঠানো যায়নি। নামিয়ে আবার চেষ্টা করুন।",
      true,
    ),
  );
  expect(mocked.save).not.toHaveBeenCalled();
});

it("requires a scope for a multi-account person and resets private notes when changing only the share scope", async () => {
  mocked.ledger = LedgerSchema.parse({
    ...mocked.ledger,
    entries: [
      ...mocked.ledger!.entries,
      {
        id: "material-bill",
        kind: "expense",
        personId: "worker",
        account: "materials",
        note: "sample-private-material-note",
        lines: [
          {
            id: "material-line",
            workId: "tiles",
            label: "নমুনা মাল কেনা",
            amount: 12000,
          },
        ],
      },
    ],
  });
  const before = JSON.stringify(mocked.ledger);
  const user = userEvent.setup();
  render(
    <StatementSheet
      person={mocked.ledger.people[0]}
      workId="tiles"
      onClose={vi.fn()}
    />,
  );
  expect(
    (screen.getByLabelText("কোন হিসাবের কপি") as HTMLSelectElement).value,
  ).toBe("");
  expect(mocked.link).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "কপি নামান" })).toBeNull();
  await user.selectOptions(screen.getByLabelText("কোন হিসাবের কপি"), "labour");
  expect(mocked.link).toHaveBeenLastCalledWith({
    personId: "worker",
    account: "labour",
    workId: "tiles",
  });
  await openFileOptions(user);
  await user.click(
    screen.getByRole("checkbox", { name: "ফাইলে আমার নোটও রাখি" }),
  );
  await user.selectOptions(
    screen.getByLabelText("কোন হিসাবের কপি"),
    "materials",
  );
  expect(mocked.link).toHaveBeenLastCalledWith({
    personId: "worker",
    account: "materials",
    workId: "tiles",
  });
  await openFileOptions(user);
  expect(
    (
      screen.getByRole("checkbox", {
        name: "ফাইলে আমার নোটও রাখি",
      }) as HTMLInputElement
    ).checked,
  ).toBe(false);
  await user.click(screen.getByRole("button", { name: "কপি নামান" }));
  await waitFor(() => expect(mocked.save).toHaveBeenCalledOnce());
  expect(mocked.statement).toHaveBeenLastCalledWith(
    mocked.ledger,
    mocked.ledger.people[0],
    { account: "materials", workId: "tiles", includeNotes: false },
  );
  const html = mocked.save.mock.calls[0][0];
  expect(html).toContain("নমুনা মাল কেনা");
  expect(html).not.toContain("নমুনা মজুরির বিল");
  expect(html).not.toContain("sample-private-material-note");
  expect(html).not.toContain("sample-private-wage-note");
  expect(JSON.stringify(mocked.ledger)).toBe(before);
});

it("can preselect the only recorded account without using a person's identity as a financial scope", () => {
  mocked.ledger = LedgerSchema.parse({
    ...mocked.ledger,
    people: [
      { ...mocked.ledger!.people[0], kind: "other" },
      mocked.ledger!.people[1],
    ],
  });
  render(<StatementSheet person={mocked.ledger.people[0]} onClose={vi.fn()} />);
  expect(
    (screen.getByLabelText("কোন হিসাবের কপি") as HTMLSelectElement).value,
  ).toBe("labour");
  expect(mocked.link).toHaveBeenLastCalledWith({
    personId: "worker",
    account: "labour",
    workId: undefined,
  });
});

// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryFrame } from "./EntryFrame";
import { Sheet } from "./Sheet";
import { TransactionAmount } from "./TransactionFields";

vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (value: string) => value,
    number: String,
    formatDigits: String,
    money: (value: number) => `৳${value / 100}`,
  }),
}));
let mobile = false;
const originalViewport = Object.getOwnPropertyDescriptor(
  window,
  "visualViewport",
);
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: mobile,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  if (!window.PointerEvent)
    window.PointerEvent = MouseEvent as typeof PointerEvent;
});
afterEach(() => {
  cleanup();
  if (originalViewport)
    Object.defineProperty(window, "visualViewport", originalViewport);
  else Reflect.deleteProperty(window, "visualViewport");
  mobile = false;
  vi.clearAllMocks();
});

it("reveals only the focused amount when the visible viewport changes", async () => {
  const user = userEvent.setup();
  const viewport = new EventTarget();
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  render(
    <EntryFrame title="হিসাব লিখি" onClose={() => {}} focusAmountWhenReady>
      <TransactionAmount label="কত টাকা" value="100" onChange={() => {}} />
      <input aria-label="অন্য ঘর" />
    </EntryFrame>,
  );
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  viewport.dispatchEvent(new Event("resize"));
  expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
    block: "center",
  });
  await user.click(screen.getByRole("textbox", { name: "অন্য ঘর" }));
  vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
  viewport.dispatchEvent(new Event("resize"));
  expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
});

function PendingForm() {
  const [ready, setReady] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return (
    <>
      <button
        onClick={() => {
          setAmount("250");
          setReady(true);
        }}
      >
        Restore draft
      </button>
      <EntryFrame
        title="হিসাব লিখি"
        onClose={() => {}}
        focusAmountWhenReady={ready}
      >
        <fieldset disabled={!ready}>
          <TransactionAmount
            label="কত টাকা"
            value={amount}
            onChange={setAmount}
          />
        </fieldset>
        <input
          aria-label="বাড়তি কথা"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </EntryFrame>
    </>
  );
}

it("focuses the actual decimal input once after restoring a disabled draft and does not steal focus on later edits", async () => {
  const user = userEvent.setup();
  render(<PendingForm />);
  await user.click(screen.getByRole("button", { name: "Restore draft" }));
  const amount = screen.getByRole("textbox", {
    name: "কত টাকা",
  }) as HTMLInputElement;
  expect(document.activeElement).toBe(amount);
  expect(amount.value).toBe("250");
  expect(amount.inputMode).toBe("decimal");
  const note = screen.getByRole("textbox", { name: "বাড়তি কথা" });
  await user.type(note, "নতুন কথা");
  expect(document.activeElement).toBe(note);
  expect(amount.value).toBe("250");
});

it("preserves interaction before draft readiness and provides a one-tap amount focus action", async () => {
  const user = userEvent.setup();
  render(<PendingForm />);
  const note = screen.getByRole("textbox", { name: "বাড়তি কথা" });
  await user.type(note, "নিজের লেখা");
  await user.click(screen.getByRole("button", { name: "Restore draft" }));
  const amount = screen.getByRole("textbox", { name: "কত টাকা" });
  expect(document.activeElement).not.toBe(amount);
  await user.click(screen.getByRole("button", { name: "টাকার ঘরে লিখুন" }));
  expect(document.activeElement).toBe(amount);
  expect((amount as HTMLInputElement).value).toBe("250");
  expect((note as HTMLInputElement).value).toBe("নিজের লেখা");
});

it.each([false, true])(
  "focuses the real amount input when opening a ready sheet (mobile: %s)",
  async (compact) => {
    mobile = compact;
    render(
      <Sheet title="খরচ লিখি" onClose={() => {}} focusAmountWhenReady>
        <TransactionAmount label="কত টাকা" value="150" onChange={() => {}} />
      </Sheet>,
    );
    const amount = screen.getByRole("textbox", { name: "কত টাকা" });
    await waitFor(() => expect(document.activeElement).toBe(amount));
    expect(
      screen.queryByRole("textbox", { name: "ক্যালকুলেটরের হিসাব" }),
    ).toBeNull();
  },
);

it("keeps the calculator's own focus and keypad while applying its result to the amount", async () => {
  const user = userEvent.setup();
  function Form() {
    const [amount, setAmount] = useState("100");
    return (
      <EntryFrame title="খরচ লিখি" onClose={() => {}} focusAmountWhenReady>
        <TransactionAmount
          label="কত টাকা"
          value={amount}
          onChange={setAmount}
        />
      </EntryFrame>
    );
  }
  render(<Form />);
  await user.click(
    screen.getByRole("button", { name: "হিসাব করার ক্যালকুলেটর" }),
  );
  const expression = screen.getByRole("textbox", {
    name: "ক্যালকুলেটরের হিসাব",
  }) as HTMLInputElement;
  expect(document.activeElement).toBe(expression);
  expect(expression.inputMode).toBe("none");
  await user.click(screen.getByRole("button", { name: "যোগ" }));
  await user.click(screen.getByRole("button", { name: "5" }));
  await user.click(screen.getByRole("button", { name: "এই টাকা লিখি" }));
  expect(
    (screen.getByRole("textbox", { name: "কত টাকা" }) as HTMLInputElement)
      .value,
  ).toBe("105");
});

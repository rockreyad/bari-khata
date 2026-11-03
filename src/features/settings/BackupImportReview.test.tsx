// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema } from "../../domain/model";
import { BackupImportReview } from "./BackupImportReview";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (value: string, data: Record<string, string> = {}) =>
      value.replace(/{{(\w+)}}/g, (_, key: string) => data[key] ?? ""),
    number: String,
    money: (amount: number) => `৳${amount / 100}`,
    date: (value: string | null) => value ?? "তারিখ জানা নেই",
  }),
}));
afterEach(cleanup);
const current = LedgerSchema.parse({
  works: [{ id: "house", name: "বাড়ি" }],
  entries: [
    {
      id: "bill",
      kind: "expense",
      lines: [{ id: "line", workId: "house", label: "মাল", amount: 444891600 }],
    },
    {
      id: "paid",
      kind: "payment",
      allocations: [{ workId: "house", amount: 510000000 }],
      paymentParts: [{ amount: 510000000 }],
    },
  ],
});
function backup(ledger = current) {
  return {
    format: "bari-khata-backup" as const,
    version: 1 as const,
    exportedAt: "2026-11-03T00:00:00Z",
    ledger,
    receipts: [],
  };
}

it("separately previews paid money and bills, without treating their difference as corrupt totals", () => {
  render(
    <BackupImportReview
      backup={backup()}
      current={LedgerSchema.parse({})}
      at="2026-11-03T00:00:00Z"
      busy={false}
      onImport={vi.fn()}
    />,
  );
  const summary = within(screen.getByRole("region", { name: "ফাইলে যা আছে" }));
  expect(
    summary.getByText("মোট টাকা দিয়েছি").parentElement?.textContent,
  ).toContain("৳5100000");
  expect(summary.getByText("খরচের বিল").parentElement?.textContent).toContain(
    "৳4448916",
  );
});

it("blocks unresolved changes, displays both versions, and requires a fresh explicit confirmation after a choice", async () => {
  const user = userEvent.setup();
  const incoming = LedgerSchema.parse({
    ...current,
    entries: current.entries.map((entry) =>
      entry.id === "bill"
        ? { ...entry, lines: [{ ...entry.lines[0], amount: 450000000 }] }
        : entry,
    ),
  });
  const onImport = vi.fn();
  render(
    <BackupImportReview
      backup={backup(incoming)}
      current={current}
      at="2026-11-03T00:00:00Z"
      busy={false}
      onImport={onImport}
    />,
  );
  const confirm = screen.getByRole("checkbox") as HTMLInputElement;
  const apply = screen.getByRole("button", {
    name: "নতুন ও বাছাই করা তথ্য আনুন",
  }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(apply.disabled).toBe(true);
  expect(screen.getByText(/এখনকার:.*4448916/)).toBeTruthy();
  expect(screen.getByText(/ফাইলের:.*4500000/)).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox"), "backup");
  expect(confirm.disabled).toBe(false);
  expect(apply.disabled).toBe(true);
  await user.click(confirm);
  await user.click(apply);
  expect(onImport).toHaveBeenCalledExactlyOnceWith({
    "entries:bill": "backup",
  });
  await user.selectOptions(screen.getByRole("combobox"), "");
  expect(confirm.checked).toBe(false);
  expect(apply.disabled).toBe(true);
});

it("shows an unchanged file as already present and offers no repeated import action", () => {
  render(
    <BackupImportReview
      backup={backup()}
      current={current}
      at="2026-11-03T00:00:00Z"
      busy={false}
      onImport={vi.fn()}
    />,
  );
  expect(
    screen.getByText("এই কপির সব তথ্য খাতায় আছে। আবার আনার দরকার নেই।"),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { LanguageProvider } from "../../context/LanguageProvider";
import { LedgerSchema, type Ledger } from "../../domain/model";
import { savePreferences } from "../../lib/preferences";
import { LedgerPage } from "./LedgerPage";

const notebook = vi.hoisted(() => ({
  ledger: null as unknown,
  detail: vi.fn(),
  add: vi.fn(),
  go: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({ ...notebook, ledger: notebook.ledger as Ledger }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});

function mount(language: "bn" | "en") {
  const ledger = LedgerSchema.parse({
    works: [{ id: "work", name: "নমুনা কাজ" }],
    materialGroups: [
      { id: "cement", name: "সিমেন্ট", aliases: ["Cement"] },
      { id: "sand", name: "বালু" },
    ],
    entries: [
      {
        id: "known",
        kind: "expense",
        lines: [
          { id: "known-line", workId: "work", label: "সিমেন্ট", amount: 10000 },
        ],
      },
      {
        id: "unload",
        kind: "expense",
        account: "other",
        lines: [
          {
            id: "unload-line",
            workId: "work",
            label: "Cement unload",
            costType: "unload",
            amount: 1000,
          },
        ],
      },
      {
        id: "ambiguous",
        kind: "expense",
        lines: [
          {
            id: "ambiguous-line",
            workId: "work",
            label: "সিমেন্ট ও বালু",
            amount: 90000,
          },
        ],
      },
    ],
  });
  notebook.ledger = ledger;
  savePreferences({ language });
  const before = JSON.stringify(ledger);
  render(
    <MemoryRouter initialEntries={["/ledger?material=group%3Acement"]}>
      <LanguageProvider>
        <LedgerPage />
      </LanguageProvider>
    </MemoryRouter>,
  );
  return { ledger, before };
}

it.each(["bn", "en"] as const)(
  "shows name-resolved material costs and a visible ambiguity warning in %s",
  (language) => {
    const { ledger, before } = mount(language);
    const region = screen.getByRole("region", {
      name: language === "bn" ? "খোঁজার হিসাব" : "Search totals",
    });
    const total = within(region)
      .getAllByRole("status")
      .find((element) => element.tagName === "OUTPUT")!;
    expect(total.textContent).toContain(language === "bn" ? "১১০" : "110");
    expect(region.textContent).toContain(
      language === "bn"
        ? "অস্পষ্ট অংশ এই মালের মোটে ধরা হয়নি"
        : "uncertain portion is excluded",
    );
    const row = screen.getByRole("button", { name: /সিমেন্ট ও বালু/ });
    expect(row.textContent).toContain(
      language === "bn" ? "মোটে ধরা হয়নি" : "excluded from total",
    );
    expect(JSON.stringify(ledger)).toBe(before);
  },
);

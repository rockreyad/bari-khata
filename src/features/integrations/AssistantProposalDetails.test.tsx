// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { McpCommandSchema } from "../../application/mcpCommands";
import { LedgerSchema } from "../../domain/model";
import { AssistantProposalDetails } from "./AssistantProposalDetails";
import { integrationsEnglish } from "./integrationsEnglish";

const locale = vi.hoisted(() => ({ language: "bn" }));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string, values: Record<string, string | number> = {}) =>
      (locale.language === "en"
        ? (integrationsEnglish[text] ?? text)
        : text
      ).replace(/{{(\w+)}}/g, (_, key: string) => String(values[key] ?? "")),
    money: (value: number) => `৳${(value / 100).toFixed(2)}`,
    date: (value: string) => `date:${value}`,
    number: String,
    formatDigits: String,
  }),
}));
const ledger = LedgerSchema.parse({
  people: [{ id: "person-one", name: "রহিম", kind: "worker" }],
  works: [{ id: "work-one", name: "ছাদের কাজ" }],
  contracts: [
    {
      id: "contract-one",
      personId: "person-one",
      workId: "work-one",
      title: "ছাদের চুক্তি",
      total: 600000,
    },
  ],
});
function mount(command: Record<string, unknown>) {
  return render(
    <AssistantProposalDetails
      ledger={ledger}
      proposal={{ id: "proposal-one", status: "pending", command }}
    />,
  );
}
beforeEach(() => {
  locale.language = "bn";
});
afterEach(cleanup);

it.each([
  ["archive_entity", "person", "person-one", "ব্যক্তি সরিয়ে রাখা", "রহিম"],
  ["restore_entity", "person", "person-one", "ব্যক্তি ফিরিয়ে আনা", "রহিম"],
  ["archive_entity", "work", "work-one", "কাজের খাতা সরিয়ে রাখা", "ছাদের কাজ"],
  ["restore_entity", "work", "work-one", "কাজের খাতা ফিরিয়ে আনা", "ছাদের কাজ"],
  [
    "archive_entity",
    "contract",
    "contract-one",
    "চুক্তি সরিয়ে রাখা",
    "ছাদের চুক্তি",
  ],
  [
    "restore_entity",
    "contract",
    "contract-one",
    "চুক্তি ফিরিয়ে আনা",
    "ছাদের চুক্তি",
  ],
])(
  "explains %s for a real %s command using the target name",
  (type, entityType, entityId, action, target) => {
    const command = McpCommandSchema.parse({
      type,
      entity_type: entityType,
      entity_id: entityId,
      reason: "ভুল করে সরিয়েছিলাম",
    });
    const { container } = mount(command);
    expect(screen.getByText(action)).toBeTruthy();
    expect(screen.getByText(target)).toBeTruthy();
    expect(screen.getByText("ভুল করে সরিয়েছিলাম")).toBeTruthy();
    expect(container.textContent).not.toContain(entityId);
    expect(container.textContent).not.toContain("entity_type");
    expect(container.textContent).not.toContain(type);
  },
);

it.each([
  ["person", "এই ব্যক্তি এই ফোনের খাতায় পাওয়া যায়নি"],
  ["work", "এই কাজের খাতা এই ফোনে পাওয়া যায়নি"],
  ["contract", "এই চুক্তি এই ফোনের খাতায় পাওয়া যায়নি"],
])(
  "makes an unresolved %s target explicit without displaying its identifier",
  (entityType, missing) => {
    const command = McpCommandSchema.parse({
      type: "archive_entity",
      entity_type: entityType,
      entity_id: "not-synced-private-id",
      reason: "সরিয়ে রাখুন",
    });
    const { container } = mount(command);
    expect(screen.getByText(missing)).toBeTruthy();
    expect(container.textContent).not.toContain("not-synced-private-id");
  },
);

it("shows localized missing-target text when an incomplete archive proposal is received", () => {
  locale.language = "en";
  mount({ type: "archive_entity", reason: "Check this action" });
  expect(screen.getByText("Archive record")).toBeTruthy();
  expect(screen.getByText("The target record is unknown")).toBeTruthy();
  expect(screen.getByText("The type is unknown")).toBeTruthy();
});

it("formats real contract rates, totals and dates with their meaning and keeps user text intact", () => {
  const command = McpCommandSchema.parse({
    type: "create_contract",
    person_id: "person-one",
    work_id: "work-one",
    scope: "work",
    title: "নতুন চুক্তি",
    basis: "day",
    quantity: "2",
    rate_paisa: 125050,
    total_paisa: 250100,
    notes: "cash",
    agreed_on: "2026-11-02",
    status: "ongoing",
  });
  const { container } = mount(command);
  expect(
    screen.getByText("দর", { selector: "dt" }).nextElementSibling?.textContent,
  ).toBe("৳1250.50");
  expect(
    screen.getByText("মোট টাকা", { selector: "dt" }).nextElementSibling
      ?.textContent,
  ).toBe("৳2501.00");
  expect(
    screen.getByText("চুক্তির তারিখ", { selector: "dt" }).nextElementSibling
      ?.textContent,
  ).toBe("date:2026-11-02");
  expect(screen.getByText("দিন ধরে")).toBeTruthy();
  expect(screen.getByText("চলছে")).toBeTruthy();
  expect(screen.getByText("cash")).toBeTruthy();
  expect(container.textContent).not.toContain("rate_paisa");
  expect(container.textContent).not.toContain("agreed_on");
});

it("localizes real work dates and display choices in English", () => {
  locale.language = "en";
  const command = McpCommandSchema.parse({
    type: "update_work",
    work_id: "work-one",
    reason: "Completed work",
    changes: {
      started_on: "2026-11-01",
      completed_on: "2026-11-02",
      status: "done",
    },
  });
  mount(command);
  expect(
    screen.getByText("Start date", { selector: "dt" }).nextElementSibling
      ?.textContent,
  ).toBe("date:2026-11-01");
  expect(
    screen.getByText("End date", { selector: "dt" }).nextElementSibling
      ?.textContent,
  ).toBe("date:2026-11-02");
  expect(screen.getByText("Completed")).toBeTruthy();
});

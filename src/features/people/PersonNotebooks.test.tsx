// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LedgerSchema } from "../../domain/model";
import { PersonNotebooks } from "./PersonNotebooks";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: String, formatDigits: String }),
}));
afterEach(cleanup);

it("lets one contact open each linked notebook and return to all notebooks without creating a job", async () => {
  const ledger = LedgerSchema.parse({
    works: [
      { id: "bathroom", name: "বাথরুম" },
      { id: "electric", name: "ইলেকট্রিক" },
    ],
    people: [
      { id: "worker", name: "মোরশেদ", workIds: ["bathroom", "electric"] },
    ],
  });
  const onSelect = vi.fn();
  render(
    <PersonNotebooks
      ledger={ledger}
      person={ledger.people[0]}
      selectedWorkId="electric"
      onSelect={onSelect}
    />,
  );
  expect(
    screen
      .getByRole("button", { name: "ইলেকট্রিক" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  await userEvent.click(screen.getByRole("button", { name: "বাথরুম" }));
  expect(onSelect).toHaveBeenLastCalledWith("bathroom");
  await userEvent.click(screen.getByRole("button", { name: "সব খাতা" }));
  expect(onSelect).toHaveBeenLastCalledWith("");
  expect(ledger.contracts).toEqual([]);
  expect(ledger.entries).toEqual([]);
});

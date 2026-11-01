// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntitySheet } from "./EntitySheet";
import { LedgerSchema, type Ledger } from "../domain/model";
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => String(value / 100),
    language: "bn",
  }),
}));
vi.mock("./Sheet", () => ({
  Sheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("../data/repository", () => ({
  createWorkspaceStorage: () => ({
    readDraft: async () => null,
    saveDraft: async () => {},
    removeDraft: async () => {},
  }),
}));
afterEach(cleanup);
describe("notebook quick action settings", () => {
  it("saves sand action choices and remembers an intentionally empty selection", async () => {
    const user = userEvent.setup();
    let saved: Ledger | undefined;
    const initial = LedgerSchema.parse({
      works: [
        {
          id: "wallet-sand",
          name: "বালু কেনা",
          quickActions: ["expense", "payment"],
        },
      ],
    });
    const onSave = vi.fn(async (value: Ledger) => {
      saved = value;
    });
    const first = render(
      <EntitySheet
        kind="work"
        editId="wallet-sand"
        ledger={initial}
        onSave={onSave}
        onClose={() => {}}
        mode="demo"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "রাখুন" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    await user.click(screen.getByText("তারিখ, বিবরণ ও পছন্দের বোতাম"));
    await user.click(screen.getByRole("button", { name: "খরচ লিখি" }));
    await user.click(screen.getByRole("button", { name: "টাকা দিলাম" }));
    await user.click(screen.getByRole("button", { name: "আনা-নামানো" }));
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(saved!.works[0].quickActions).toEqual(["transport"]);
    expect(saved!.works[0].activity[0].after.quickActions).toEqual([
      "transport",
    ]);
    first.unmount();
    const second = render(
      <EntitySheet
        kind="work"
        editId="wallet-sand"
        ledger={saved!}
        onSave={onSave}
        onClose={() => {}}
        mode="demo"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "রাখুন" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    await user.click(screen.getByText("তারিখ, বিবরণ ও পছন্দের বোতাম"));
    expect(
      screen
        .getByRole("button", { name: "আনা-নামানো" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "খরচ লিখি" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    await user.click(screen.getByRole("button", { name: "আনা-নামানো" }));
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(saved!.works[0].quickActions).toEqual([]);
    second.unmount();
    render(
      <EntitySheet
        kind="work"
        editId="wallet-sand"
        ledger={saved!}
        onSave={onSave}
        onClose={() => {}}
        mode="demo"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "রাখুন" }).hasAttribute("disabled"),
      ).toBe(false),
    );
    await user.click(screen.getByText("তারিখ, বিবরণ ও পছন্দের বোতাম"));
    for (const name of ["খরচ লিখি", "টাকা দিলাম", "মজুরি", "আনা-নামানো"])
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-pressed"),
      ).toBe("false");
  });
});

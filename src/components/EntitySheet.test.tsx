// @vitest-environment jsdom
import type { ReactNode, SelectHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntitySheet } from "./EntitySheet";
import { LedgerSchema, type Ledger } from "../domain/model";
import { contactEntryPolicy } from "../domain/contactEntryPolicy";
import { planHousePayment } from "../domain/housePayments";
import { QuickDraftSchema } from "../features/entries/quickEntry";
import { recordHouseCost } from "../features/write/houseCost";
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    formatDigits: String,
    number: String,
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
vi.mock("./ui/AppSelect", () => ({
  AppSelect: (props: SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props} />
  ),
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
    await user.click(screen.getByRole("button", { name: "আনার খরচ" }));
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
        .getByRole("button", { name: "আনার খরচ" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "খরচ লিখি" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    await user.click(screen.getByRole("button", { name: "আনার খরচ" }));
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
    for (const name of ["খরচ লিখি", "টাকা দিলাম", "মিস্ত্রির টাকা", "আনার খরচ"])
      expect(
        screen.getByRole("button", { name }).getAttribute("aria-pressed"),
      ).toBe("false");
  });
});

describe("contact import in a person's form", () => {
  it.each(["", "দরজার দোকান"])(
    "fills a chosen phone and keeps an existing name: %s",
    async (existingName) => {
      const user = userEvent.setup();
      const select = vi
        .fn()
        .mockResolvedValue([{ name: ["শাহ আলম"], tel: ["01700000091"] }]);
      Object.defineProperty(window, "isSecureContext", {
        configurable: true,
        value: true,
      });
      Object.defineProperty(navigator, "contacts", {
        configurable: true,
        value: { select },
      });
      const onSave = vi.fn(async (_value: Ledger) => {});
      try {
        render(
          <EntitySheet
            kind="person"
            ledger={LedgerSchema.parse({})}
            onSave={onSave}
            onClose={() => {}}
            mode="demo"
          />,
        );
        await waitFor(() =>
          expect(
            screen
              .getByRole("button", { name: "রাখুন" })
              .hasAttribute("disabled"),
          ).toBe(false),
        );
        await user.selectOptions(
          screen.getByLabelText("কীভাবে যুক্ত"),
          "supplier",
        );
        if (existingName)
          await user.type(screen.getByLabelText("দোকানের নাম"), existingName);
        await user.click(
          screen.getByRole("button", { name: "কন্টাক্ট থেকে নিন" }),
        );
        expect(
          (screen.getByLabelText("ফোন নম্বর") as HTMLInputElement).value,
        ).toBe("01700000091");
        expect(
          (screen.getByLabelText("দোকানের নাম") as HTMLInputElement).value,
        ).toBe(existingName || "শাহ আলম");
        await user.click(screen.getByRole("button", { name: "রাখুন" }));
        await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][0].people[0]).toMatchObject({
          name: existingName || "শাহ আলম",
          phone: "01700000091",
          kind: "shop",
        });
      } finally {
        Reflect.deleteProperty(navigator, "contacts");
      }
    },
  );
});

it.each([
  {
    preset: "দোকানদার",
    presetId: "supplier",
    kind: "shop",
    role: "নমুনা ইট ও বালু",
    actions: ["payment", "purchase", "return"],
    agreement: false,
  },
  {
    preset: "ইঞ্জিনিয়ার / পরামর্শক",
    presetId: "professional",
    kind: "worker",
    role: "নমুনা নকশার পরামর্শক",
    actions: ["payment"],
    agreement: true,
  },
  {
    preset: "গাড়ি / পরিবহন",
    presetId: "transport",
    kind: "driver",
    role: "নমুনা পিকআপ সেবা",
    actions: ["payment", "transport"],
    agreement: false,
  },
  {
    preset: "অন্যান্য সেবা",
    presetId: "service",
    kind: "worker",
    role: "নমুনা সুইপার",
    actions: ["payment"],
    agreement: true,
  },
])(
  "uses the $preset relationship for initial actions and keeps later description edits descriptive",
  async ({ preset, presetId, kind, role, actions, agreement }) => {
    const user = userEvent.setup();
    const ledger = LedgerSchema.parse({
      works: [{ id: "work", name: "নমুনা কাজ" }],
      people: [{ id: "existing", name: "আগের নমুনা নাম", kind: "other" }],
      entries: [
        {
          id: "old-bill",
          kind: "expense",
          personId: "existing",
          lines: [{ id: "line", workId: "work", amount: 12000 }],
        },
      ],
    });
    const onSave = vi.fn(async (_value: Ledger) => {});
    render(
      <EntitySheet
        kind="person"
        ledger={ledger}
        onSave={onSave}
        onClose={() => {}}
        mode="demo"
      />,
    );
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      (screen.getByLabelText("কীভাবে যুক্ত") as HTMLSelectElement).value,
    ).toBe("");
    expect(document.querySelector("form input")).toBe(
      screen.getByLabelText("নাম"),
    );
    expect(screen.queryByRole("button", { name: preset })).toBeNull();
    await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), presetId);
    const supplier = kind === "shop";
    fireEvent.change(screen.getByLabelText(supplier ? "দোকানের নাম" : "নাম"), {
      target: { value: "নমুনা নতুন নাম" },
    });
    fireEvent.change(
      screen.getByLabelText(
        supplier ? "কী বিক্রি করেন" : "পরিচয় / কী কাজ করেন",
      ),
      { target: { value: role } },
    );
    expect(
      (screen.getByLabelText("কীভাবে যুক্ত") as HTMLSelectElement).value,
    ).toBe(presetId);
    expect(screen.queryByLabelText("কাজের টাকা") !== null).toBe(agreement);
    await user.click(screen.getByText("কোন হিসাব রাখবেন"));
    for (const [action, label] of [
      ["payment", "টাকা দিলাম"],
      ["purchase", "মাল কেনা"],
      ["return", "মাল ফেরত"],
      ["transport", "আনার খরচ"],
    ]) {
      const button = screen.getByRole("button", {
        name: label,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(!actions.includes(action));
      expect(button.getAttribute("aria-pressed")).toBe(
        String(actions.includes(action)),
      );
      if (!actions.includes(action)) {
        await user.click(button);
        expect(button.getAttribute("aria-pressed")).toBe("false");
      }
    }
    await user.click(screen.getByRole("button", { name: "রাখুন" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const next = onSave.mock.calls[0][0];
    expect(
      next.people.find((person) => person.id !== "existing"),
    ).toMatchObject({
      name: "নমুনা নতুন নাম",
      kind,
      role,
      quickActions: actions,
    });
    expect(next.entries).toEqual(ledger.entries);
    expect(next.contracts).toEqual(ledger.contracts);
  },
);

it("changes available buttons with the selected relationship without treating free text as a relationship", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async (_value: Ledger) => {});
  render(
    <EntitySheet
      kind="person"
      ledger={LedgerSchema.parse({})}
      onSave={onSave}
      onClose={() => {}}
      mode="demo"
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await user.type(screen.getByLabelText("নাম"), "নমুনা সম্পর্ক বদল");
  await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "supplier");
  await user.click(screen.getByText("কোন হিসাব রাখবেন"));
  const purchase = screen.getByRole("button", {
    name: "মাল কেনা",
  }) as HTMLButtonElement;
  const transport = screen.getByRole("button", {
    name: "আনার খরচ",
  }) as HTMLButtonElement;
  expect(purchase.disabled).toBe(false);
  expect(transport.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("কী বিক্রি করেন"), {
    target: { value: "সুইপার" },
  });
  expect(purchase.disabled).toBe(false);
  expect(transport.disabled).toBe(true);
  await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "transport");
  expect(purchase.disabled).toBe(true);
  expect(purchase.getAttribute("aria-pressed")).toBe("false");
  expect(transport.disabled).toBe(false);
  expect(transport.getAttribute("aria-pressed")).toBe("true");
  await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "service");
  expect(purchase.disabled).toBe(true);
  expect(transport.disabled).toBe(true);
  expect(transport.getAttribute("aria-pressed")).toBe("false");
  await user.click(purchase);
  await user.click(transport);
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].people[0]).toMatchObject({
    kind: "worker",
    quickActions: ["payment"],
  });
});

it("keeps an entered agreement open and focused while clearing and replacing its amount after a relationship change", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async (_ledger: Ledger) => {});
  render(
    <EntitySheet
      kind="person"
      ledger={LedgerSchema.parse({})}
      onSave={onSave}
      onClose={vi.fn()}
      mode="demo"
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await user.type(screen.getByLabelText("নাম"), "নমুনা ব্যক্তি");
  await user.selectOptions(
    screen.getByLabelText("কীভাবে যুক্ত"),
    "craftsperson",
  );
  let input = screen.getByLabelText("কাজের টাকা") as HTMLInputElement;
  const disclosure = input.closest("details") as HTMLDetailsElement;
  await user.click(disclosure.querySelector("summary")!);
  await waitFor(() => expect(disclosure.open).toBe(true));
  await user.type(input, "125");
  await user.selectOptions(screen.getByLabelText("কীভাবে যুক্ত"), "supplier");
  input = screen.getByLabelText("কাজের টাকা") as HTMLInputElement;
  await user.clear(input);
  expect(disclosure.open).toBe(true);
  expect(document.activeElement).toBe(input);
  expect(screen.getByLabelText("কাজের টাকা")).toBe(input);
  await user.type(input, "275");
  expect(input.value).toBe("275");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "এই ধরনের নামে",
  );
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.queryByText("আরও কাজ বা সম্পর্ক")).toBeNull();
  await user.selectOptions(
    screen.getByLabelText("কীভাবে যুক্ত"),
    "craftsperson",
  );
  expect(input.value).toBe("275");
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].contracts).toEqual([
    expect.objectContaining({ total: 27500, scope: "house" }),
  ]);
});

it("lets a neutral contact configure purchase and transport while disabling payment, and applies those choices to new commands", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async (_ledger: Ledger) => {});
  render(
    <EntitySheet
      kind="person"
      ledger={LedgerSchema.parse({})}
      onSave={onSave}
      onClose={vi.fn()}
      mode="demo"
    />,
  );
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "রাখুন" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  await user.type(screen.getByLabelText("নাম"), "নমুনা নিজের মতো নাম");
  await user.click(screen.getByText("কোন হিসাব রাখবেন"));
  for (const name of ["টাকা দিলাম", "মাল কেনা", "মাল ফেরত", "আনার খরচ"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
  }
  await user.click(screen.getByRole("button", { name: "টাকা দিলাম" }));
  await user.click(screen.getByRole("button", { name: "মাল ফেরত" }));
  await user.click(screen.getByRole("button", { name: "রাখুন" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  const saved = onSave.mock.calls[0][0];
  expect(saved.people[0]).toMatchObject({
    contactType: "custom",
    quickActions: ["purchase", "transport"],
  });
  expect(contactEntryPolicy(saved.people[0])).toMatchObject({
    purchase: true,
    payment: false,
    chargeCostTypes: ["transport"],
  });
  const bill = recordHouseCost(
    saved,
    QuickDraftSchema.parse({
      id: "sample-bill",
      paymentId: "sample-paid",
      refundId: "sample-refund",
      date: "2026-11-05",
      personId: saved.people[0].id,
      payment: "due",
      rows: [{ id: "sample-line", label: "নমুনা মাল", amount: "100" }],
    }),
    [],
    "সাধারণ খরচ",
  );
  expect(bill.entries[0].account).toBe("materials");
  expect(
    planHousePayment(bill, {
      personId: saved.people[0].id,
      amount: 1000,
      intent: "advance",
    }).issues,
  ).toContain("contact_rules");
});

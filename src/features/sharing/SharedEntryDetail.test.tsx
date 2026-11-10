// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedEntrySchema } from "./shareModel";
import {
  SharedEntryDetail,
  type SharedEntryDetailProps,
} from "./SharedEntryDetail";
const mocked = vi.hoisted(() => ({
  detail: vi.fn(),
  receipt: vi.fn(),
  payments: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("./shareClient", () => ({
  readSharedEntry: mocked.detail,
  readSharedReceipt: mocked.receipt,
  readSharedPayments: mocked.payments,
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    date: (value: string | null) => value ?? "তারিখ জানা নেই",
    formatDigits: String,
  }),
}));
const NativeURL = URL;
const token = "a".repeat(64);
const pdf = () => new Blob(["%PDF-sample"], { type: "application/pdf" });
const fixture = (key = "sample-entry") =>
  SharedEntrySchema.parse({
    key,
    revision: 7,
    kind: "payment",
    date: "2026-11-01",
    historical: false,
    charge: 0,
    paid: 10000,
    description: "নমুনা বিবরণ",
    works: "নমুনা দরজা",
    note: "নমুনা পরিশোধের নোট",
    paymentParts: [
      { method: "bkash", amount: 7000 },
      { method: "cash", amount: 3000 },
    ],
    paymentMethods: ["bkash", "cash"],
    lines: [],
    receipts: [
      {
        id: "sample-receipt",
        name: "sample.pdf",
        mime: "application/pdf",
        size: pdf().size,
      },
    ],
  });
function props(): SharedEntryDetailProps {
  return {
    token,
    entryId: "sample-entry",
    revision: 7,
    onClose: vi.fn(),
    onUnavailable: vi.fn(),
    onStale: vi.fn(),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", `#${token}`);
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "URL",
    class extends NativeURL {
      static createObjectURL = mocked.create;
      static revokeObjectURL = mocked.revoke;
    },
  );
  mocked.create.mockReturnValue("blob:sample-voucher");
  mocked.detail.mockResolvedValue(fixture());
  mocked.receipt.mockResolvedValue(pdf());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const billPayments = (offset: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    key: `payment-${offset + index}`,
    date: "2026-11-04",
    paid: 100,
    description: `কিস্তি ${offset + index}`,
    paymentParts: [{ method: "cash", amount: 100 }],
    paymentMethods: ["cash"],
  }));
function pagedBill(total = 21) {
  return SharedEntrySchema.parse({
    ...fixture(),
    kind: "expense",
    charge: total * 100,
    paid: 0,
    note: "বিলের নোট",
    description: "নমুনা মাল",
    lines: [
      { label: "নমুনা মাল", amount: total * 100, workName: "নমুনা খাতা" },
    ],
    paymentParts: [],
    paymentMethods: [],
    receipts: [],
    settlement: {
      paid: total * 100,
      returned: 0,
      refunded: 0,
      balance: 0,
      paymentCount: total,
    },
    payments: billPayments(0, 20),
    paymentsTotal: total,
    paymentsNextOffset: 20,
  });
}
it("loads payment history only on request, prevents duplicate taps and removes the button after the last page", async () => {
  mocked.detail.mockResolvedValue(pagedBill());
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  mocked.payments.mockReturnValueOnce(pending);
  render(<SharedEntryDetail {...props()} />);
  await screen.findByText("বিলের নোট");
  expect(screen.getAllByRole("button", { name: /^পরিশোধ ·/ })).toHaveLength(20);
  expect(mocked.payments).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "আরও দেখুন" });
  await userEvent.click(button);
  await userEvent.click(button);
  expect(mocked.payments).toHaveBeenCalledExactlyOnceWith(
    token,
    "sample-entry",
    7,
    20,
    { signal: expect.any(AbortSignal) },
  );
  await act(async () => {
    finish({
      key: "sample-entry",
      revision: 7,
      total: 21,
      nextOffset: null,
      payments: billPayments(20, 1),
    });
    await pending;
  });
  expect(screen.getAllByRole("button", { name: /^পরিশোধ ·/ })).toHaveLength(21);
  expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
});
it("keeps the current page and retries the same offset after a temporary payment request failure", async () => {
  mocked.detail.mockResolvedValue(pagedBill());
  mocked.payments
    .mockRejectedValueOnce(new Error("share_request_failed"))
    .mockResolvedValueOnce({
      key: "sample-entry",
      revision: 7,
      total: 21,
      nextOffset: null,
      payments: billPayments(20, 1),
    });
  render(<SharedEntryDetail {...props()} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "আরও দেখুন" }),
  );
  await screen.findByRole("alert");
  expect(screen.getAllByRole("button", { name: /^পরিশোধ ·/ })).toHaveLength(20);
  await userEvent.click(
    screen.getByRole("button", { name: "আবার চেষ্টা করুন" }),
  );
  await screen.findByText("কিস্তি 20");
  expect(mocked.payments.mock.calls.map((call) => call[3])).toEqual([20, 20]);
  expect(screen.queryByRole("alert")).toBeNull();
});
it.each(["missing", "stale"])(
  "clears detail when a later payment page is %s",
  async (state) => {
    const callbacks = props();
    mocked.detail.mockResolvedValue(pagedBill());
    if (state === "missing") mocked.payments.mockResolvedValueOnce(null);
    else mocked.payments.mockRejectedValueOnce(new Error("share_changed"));
    render(<SharedEntryDetail {...callbacks} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "আরও দেখুন" }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("বিলের নোট")).toBeNull();
    expect(
      state === "missing" ? callbacks.onUnavailable : callbacks.onStale,
    ).toHaveBeenCalledOnce();
  },
);
it.each(["unmount", "hash"])(
  "aborts a payment page on %s and ignores its late response",
  async (reason) => {
    mocked.detail.mockResolvedValue(pagedBill());
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    mocked.payments.mockReturnValueOnce(pending);
    const view = render(<SharedEntryDetail {...props()} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "আরও দেখুন" }),
    );
    const signal = mocked.payments.mock.calls[0][4].signal as AbortSignal;
    if (reason === "unmount") view.unmount();
    else
      await act(async () => {
        window.history.replaceState(null, "", `#${"b".repeat(64)}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
    await act(async () => {
      finish({
        key: "sample-entry",
        revision: 7,
        total: 21,
        nextOffset: null,
        payments: billPayments(20, 1),
      });
      await pending;
    });
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText("কিস্তি 20")).toBeNull();
  },
);
it("opens an accessible read-only detail with notes and exact methods without fetching vouchers", async () => {
  const source = fixture();
  const before = JSON.stringify(source);
  mocked.detail.mockResolvedValue(source);
  render(<SharedEntryDetail {...props()} />);
  expect(
    screen.getByRole("dialog", { name: "লেনদেনের বিস্তারিত" }),
  ).toBeTruthy();
  await screen.findByText("নমুনা পরিশোধের নোট");
  expect(screen.getByText("পরিশোধ")).toBeTruthy();
  expect(screen.queryByText("টাকা পেয়েছেন")).toBeNull();
  expect(screen.getByText("বিকাশ")).toBeTruthy();
  expect(screen.getByText("৳70")).toBeTruthy();
  expect(screen.getByText("ক্যাশ")).toBeTruthy();
  expect(screen.getByText("৳30")).toBeTruthy();
  expect(screen.getByText("নমুনা বিবরণ")).toBeTruthy();
  expect(mocked.detail).toHaveBeenCalledWith(token, "sample-entry", 7, {
    signal: expect.any(AbortSignal),
  });
  expect(mocked.receipt).not.toHaveBeenCalled();
  expect(JSON.stringify(source)).toBe(before);
});
it("shows bill lines once instead of repeating their combined description", async () => {
  mocked.detail.mockResolvedValue(
    SharedEntrySchema.parse({
      ...fixture(),
      kind: "expense",
      charge: 10000,
      paid: 0,
      description: "নমুনা মাল",
      lines: [{ label: "নমুনা মাল", amount: 10000, workName: "নমুনা দরজা" }],
      paymentParts: [],
      paymentMethods: [],
    }),
  );
  render(<SharedEntryDetail {...props()} />);
  await screen.findByText("বিলের বিবরণ");
  expect(screen.getAllByText("নমুনা মাল")).toHaveLength(1);
  expect(screen.queryByRole("heading", { name: "বিবরণ" })).toBeNull();
  expect(screen.queryByText("পরিশোধের মাধ্যম")).toBeNull();
});
it("shows the purchased items and quantity when opening a linked payment, with bill and payment amounts kept distinct", async () => {
  mocked.detail.mockResolvedValue({
    ...fixture(),
    description: "নমুনা সিমেন্ট",
    relatedBill: {
      key: "sample-bill",
      date: "2026-10-30",
      charge: 20000,
      lines: [
        {
          label: "নমুনা সিমেন্ট",
          amount: 18000,
          workName: "নমুনা ছাদ",
          quantity: 2,
          unit: "বস্তা",
        },
        { label: "নমুনা বালু", amount: 2000, workName: "নমুনা ছাদ" },
      ],
    },
  });
  render(<SharedEntryDetail {...props()} />);
  await screen.findByText("বিলের বিবরণ");
  expect(screen.getAllByText("নমুনা সিমেন্ট")).toHaveLength(1);
  expect(screen.getByText("নমুনা বালু")).toBeTruthy();
  expect(screen.getByText("2 বস্তা")).toBeTruthy();
  expect(screen.getByText("৳100")).toBeTruthy();
  expect(screen.getByText("৳200")).toBeTruthy();
  expect(screen.getByText("2026-10-30")).toBeTruthy();
  expect(screen.getByText("যে বিলের টাকা দেওয়া হয়েছে")).toBeTruthy();
  expect(
    screen.queryByText("এই টাকার সঙ্গে কোনো বিলের বিবরণ লেখা নেই।"),
  ).toBeNull();
});
it("shows payment history inside a bill and opens its note in the same sheet before returning to the bill", async () => {
  const bill = {
    ...fixture(),
    kind: "expense",
    charge: 10000,
    paid: 0,
    description: "নমুনা মাল",
    note: "",
    paymentParts: [],
    paymentMethods: [],
    lines: [{ label: "নমুনা মাল", amount: 10000, workName: "নমুনা দরজা" }],
    receipts: [],
    payments: [
      {
        key: "sample-part-payment",
        date: "2026-11-02",
        paid: 4000,
        description: "",
        paymentParts: [{ method: "cash", amount: 4000 }],
        paymentMethods: ["cash"],
      },
    ],
  };
  const before = JSON.stringify(bill);
  mocked.detail
    .mockResolvedValueOnce(bill)
    .mockResolvedValueOnce({
      ...fixture("sample-part-payment"),
      date: "2026-11-02",
      paid: 4000,
      description: "",
      note: "নমুনা কিস্তির নোট",
      paymentParts: [{ method: "cash", amount: 4000 }],
      paymentMethods: ["cash"],
      relatedBill: {
        key: bill.key,
        date: bill.date,
        charge: bill.charge,
        lines: bill.lines,
      },
    })
    .mockResolvedValueOnce(bill);
  render(<SharedEntryDetail {...props()} />);
  await screen.findByRole("heading", { name: "টাকা দেওয়ার হিসাব" });
  expect(screen.getByText("৳40")).toBeTruthy();
  expect(screen.getByText("ক্যাশ")).toBeTruthy();
  const billSignal = mocked.detail.mock.calls[0][3].signal as AbortSignal;
  await userEvent.click(
    screen.getByRole("button", {
      name: "পরিশোধ · 2026-11-02 · ৳40 · বিস্তারিত",
    }),
  );
  await screen.findByText("নমুনা কিস্তির নোট");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByText("নমুনা মাল")).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "টাকা দেওয়ার হিসাব" }),
  ).toBeNull();
  expect(billSignal.aborted).toBe(true);
  expect(mocked.receipt).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "আগের হিসাবে ফিরুন" }),
  );
  await screen.findByRole("heading", { name: "টাকা দেওয়ার হিসাব" });
  expect(screen.queryByText("নমুনা কিস্তির নোট")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "আগের হিসাবে ফিরুন" }),
  ).toBeNull();
  expect(JSON.stringify(bill)).toBe(before);
});
it.each(["মোট মজুরির চুক্তি", "আগাম টাকা"])(
  "shows a standalone payment's %s without treating a missing bill as a problem",
  async (description) => {
    mocked.detail.mockResolvedValue({ ...fixture(), description });
    render(<SharedEntryDetail {...props()} />);
    await screen.findByText(description);
    expect(
      screen.queryByText("এই টাকার সঙ্গে কোনো বিলের বিবরণ লেখা নেই।"),
    ).toBeNull();
    expect(screen.queryByRole("heading", { name: "বিলের বিবরণ" })).toBeNull();
    expect(screen.queryByText("যে বিলের টাকা দেওয়া হয়েছে")).toBeNull();
    expect(screen.getByText("নমুনা দরজা")).toBeTruthy();
    expect(screen.getByText("নমুনা পরিশোধের নোট")).toBeTruthy();
    expect(screen.getByText("বিকাশ")).toBeTruthy();
  },
);
it.each(["missing", "stale"] as const)(
  "clears private detail when authorization is %s",
  async (state) => {
    const callbacks = props();
    if (state === "missing") mocked.detail.mockResolvedValue(null);
    else mocked.detail.mockRejectedValue(new Error("share_changed"));
    render(<SharedEntryDetail {...callbacks} />);
    await screen.findByRole("alert");
    expect(
      state === "missing" ? callbacks.onUnavailable : callbacks.onStale,
    ).toHaveBeenCalledOnce();
    expect(screen.queryByText("নমুনা পরিশোধের নোট")).toBeNull();
    expect(mocked.receipt).not.toHaveBeenCalled();
  },
);
it("never publishes an obsolete entry response after the selected entry changes", async () => {
  let finish!: (value: ReturnType<typeof fixture>) => void;
  const pending = new Promise<ReturnType<typeof fixture>>((resolve) => {
    finish = resolve;
  });
  mocked.detail.mockReturnValueOnce(pending).mockResolvedValueOnce({
    ...fixture("sample-next"),
    description: "নমুনা পরের বিবরণ",
    note: "",
  });
  const callbacks = props();
  const view = render(<SharedEntryDetail {...callbacks} />);
  const signal = mocked.detail.mock.calls[0][3].signal as AbortSignal;
  view.rerender(<SharedEntryDetail {...callbacks} entryId="sample-next" />);
  await screen.findByText("নমুনা পরের বিবরণ");
  await act(async () => {
    finish(fixture());
    await pending;
  });
  expect(signal.aborted).toBe(true);
  expect(screen.queryByText("নমুনা পরিশোধের নোট")).toBeNull();
  expect(screen.getByText("নমুনা পরের বিবরণ")).toBeTruthy();
});
it("fetches a PDF only on explicit request and revokes its download URL on close", async () => {
  const callbacks = props();
  render(<SharedEntryDetail {...callbacks} />);
  await screen.findByText("নমুনা বিবরণ");
  await userEvent.click(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-1-2026-11-01.pdf",
    }),
  );
  const link = await screen.findByRole("link", { name: "ভাউচার নামান" });
  expect(link.getAttribute("href")).toBe("blob:sample-voucher");
  expect(link.getAttribute("download")).toBe("voucher-1-2026-11-01.pdf");
  expect(
    screen
      .getByRole("dialog", { name: "ভাউচার দেখি" })
      .querySelector("object")
      ?.getAttribute("data"),
  ).toBe("blob:sample-voucher");
  expect(screen.queryByRole("img")).toBeNull();
  expect(mocked.receipt).toHaveBeenCalledWith(
    token,
    "sample-entry",
    "sample-receipt",
    7,
    { signal: expect.any(AbortSignal) },
  );
  await userEvent.click(screen.getByRole("button", { name: "বন্ধ করুন" }));
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-1-2026-11-01.pdf",
    }),
  ).toBe(document.activeElement);
  expect(mocked.revoke).toHaveBeenCalledExactlyOnceWith("blob:sample-voucher");
});
it("keeps only one image preview and revokes each object URL on close and unmount", async () => {
  const image = new Blob(["sample image"], { type: "image/png" });
  mocked.detail.mockResolvedValue({
    ...fixture(),
    receipts: ["one", "two"].map((id) => ({
      id,
      name: `${id}.png`,
      mime: "image/png",
      size: image.size,
    })),
  });
  mocked.receipt.mockResolvedValue(image);
  mocked.create
    .mockReturnValueOnce("blob:first")
    .mockReturnValueOnce("blob:second");
  const view = render(<SharedEntryDetail {...props()} />);
  await screen.findByText("নমুনা বিবরণ");
  await userEvent.click(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-1-2026-11-01.png",
    }),
  );
  expect(
    (
      await screen.findByRole("img", { name: "voucher-1-2026-11-01.png" })
    ).getAttribute("src"),
  ).toBe("blob:first");
  await userEvent.keyboard("{Escape}");
  await userEvent.click(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-2-2026-11-01.png",
    }),
  );
  await screen.findByRole("img", { name: "voucher-2-2026-11-01.png" });
  expect(
    screen.getByRole("link", { name: "ভাউচার নামান" }).getAttribute("download"),
  ).toBe("voucher-2-2026-11-01.png");
  expect(
    screen.queryByRole("img", { name: "voucher-1-2026-11-01.png" }),
  ).toBeNull();
  expect(mocked.revoke).toHaveBeenCalledWith("blob:first");
  view.unmount();
  expect(mocked.revoke).toHaveBeenCalledWith("blob:second");
});
it("aborts a pending voucher on unmount and never creates a URL from its late bytes", async () => {
  let finish!: (value: Blob) => void;
  const pending = new Promise<Blob>((resolve) => {
    finish = resolve;
  });
  mocked.receipt.mockReturnValue(pending);
  const view = render(<SharedEntryDetail {...props()} />);
  await screen.findByText("নমুনা বিবরণ");
  await userEvent.click(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-1-2026-11-01.pdf",
    }),
  );
  const signal = mocked.receipt.mock.calls[0][4].signal as AbortSignal;
  view.unmount();
  await act(async () => {
    finish(pdf());
    await pending;
  });
  expect(signal.aborted).toBe(true);
  expect(mocked.create).not.toHaveBeenCalled();
});
it.each(["share_unavailable", "share_changed"])(
  "removes details when an explicit voucher request reports %s",
  async (error) => {
    const callbacks = props();
    mocked.receipt.mockRejectedValue(new Error(error));
    render(<SharedEntryDetail {...callbacks} />);
    await screen.findByText("নমুনা বিবরণ");
    await userEvent.click(
      screen.getByRole("button", {
        name: "ভাউচার দেখি: voucher-1-2026-11-01.pdf",
      }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("নমুনা পরিশোধের নোট")).toBeNull();
    expect(
      error === "share_changed" ? callbacks.onStale : callbacks.onUnavailable,
    ).toHaveBeenCalledOnce();
    expect(mocked.create).not.toHaveBeenCalled();
  },
);
it("rejects an unsafe voucher type without exposing a browser URL", async () => {
  mocked.receipt.mockResolvedValue(
    new Blob(["<html>sample</html>"], { type: "text/html" }),
  );
  render(<SharedEntryDetail {...props()} />);
  await screen.findByText("নমুনা বিবরণ");
  await userEvent.click(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-1-2026-11-01.pdf",
    }),
  );
  await screen.findByText("ভাউচার খোলা যায়নি। আবার চেষ্টা করুন।");
  expect(mocked.create).not.toHaveBeenCalled();
});
it("does not invent methods, notes or vouchers for a redacted partial-work detail", async () => {
  mocked.detail.mockResolvedValue({
    ...fixture(),
    note: "",
    paymentParts: [],
    paymentMethods: [],
    receipts: [],
  });
  render(<SharedEntryDetail {...props()} />);
  await screen.findByText("নমুনা বিবরণ");
  expect(screen.queryByText("নোট")).toBeNull();
  expect(screen.queryByText("পরিশোধের মাধ্যম")).toBeNull();
  expect(screen.queryByText("ছবি ও ভাউচার")).toBeNull();
});

it("keeps a valid detail available through a temporary receipt failure and lets the request be retried", async () => {
  const callbacks = props();
  mocked.receipt
    .mockRejectedValueOnce(new Error("share_receipt_failed"))
    .mockResolvedValueOnce(pdf());
  render(<SharedEntryDetail {...callbacks} />);
  await screen.findByText("নমুনা বিবরণ");
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-1-2026-11-01.pdf",
    }),
  );
  await screen.findByText("ভাউচার খোলা যায়নি। আবার চেষ্টা করুন।");
  expect(screen.getByText("নমুনা পরিশোধের নোট")).toBeTruthy();
  expect(callbacks.onUnavailable).not.toHaveBeenCalled();
  expect(callbacks.onStale).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await user.click(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-1-2026-11-01.pdf",
    }),
  );
  await screen.findByRole("link", { name: "ভাউচার নামান" });
  expect(screen.queryByRole("alert")).toBeNull();
});

it.each(["key", "revision"] as const)(
  "does not reveal a detail bound to a different %s",
  async (field) => {
    const callbacks = props();
    mocked.detail.mockResolvedValue({
      ...fixture(),
      ...(field === "key" ? { key: "sample-other" } : { revision: 8 }),
    });
    render(<SharedEntryDetail {...callbacks} />);
    await screen.findByRole("alert");
    expect(callbacks.onStale).toHaveBeenCalledOnce();
    expect(screen.queryByText("নমুনা পরিশোধের নোট")).toBeNull();
  },
);

it("never creates a voucher URL after the capability hash changes before its navigation event", async () => {
  let finish!: (value: Blob) => void;
  const pending = new Promise<Blob>((resolve) => {
    finish = resolve;
  });
  mocked.receipt.mockReturnValue(pending);
  const callbacks = props();
  render(<SharedEntryDetail {...callbacks} />);
  await screen.findByText("নমুনা বিবরণ");
  await userEvent.click(
    screen.getByRole("button", {
      name: "ভাউচার দেখি: voucher-1-2026-11-01.pdf",
    }),
  );
  await act(async () => {
    window.history.replaceState(null, "", `#${"b".repeat(64)}`);
    finish(pdf());
    await pending;
  });
  expect(mocked.create).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(callbacks.onClose).toHaveBeenCalledOnce();
  expect(screen.queryByText("নমুনা পরিশোধের নোট")).toBeNull();
});

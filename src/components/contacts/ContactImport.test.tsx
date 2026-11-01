// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContactImport } from "./ContactImport";
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (text: string) => text }),
}));
beforeEach(() => {
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "contacts");
  vi.restoreAllMocks();
});
function native(select: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "contacts", {
    configurable: true,
    value: { select },
  });
}

describe("contact import", () => {
  it("requests only one contact's name and phone, then lets the user choose among numbers", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const select = vi
      .fn()
      .mockResolvedValue([
        { name: ["শাহ আলম"], tel: ["01700000091", "01700000092"] },
      ]);
    native(select);
    render(<ContactImport onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: "কন্টাক্ট থেকে নিন" }));
    expect(select).toHaveBeenCalledWith(["name", "tel"], { multiple: false });
    expect(onPick).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "01700000092" }));
    expect(onPick).toHaveBeenCalledWith({
      name: "শাহ আলম",
      phone: "01700000092",
    });
  });
  it("cancelling the native picker leaves the form untouched", async () => {
    const onPick = vi.fn();
    native(vi.fn().mockRejectedValue(new DOMException("cancel", "AbortError")));
    render(<ContactImport onPick={onPick} />);
    await userEvent.click(
      screen.getByRole("button", { name: "কন্টাক্ট থেকে নিন" }),
    );
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("offers an honest file fallback on iPhone/unsupported browsers and imports only one contact", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ContactImport onPick={onPick} />);
    await user.click(screen.getByRole("button", { name: "কন্টাক্ট থেকে নিন" }));
    expect(
      screen.getByText(/এই ফোনে সরাসরি কন্টাক্ট বাছাই করা যায় না/),
    ).toBeTruthy();
    const file = new File([""], "contact.vcf", { type: "text/vcard" });
    Object.defineProperty(file, "text", {
      value: async () =>
        "BEGIN:VCARD\nFN:দরজার দোকান\nTEL:01700000091\nEND:VCARD",
    });
    await user.upload(screen.getByLabelText("কন্টাক্ট ফাইল"), file);
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith({
        name: "দরজার দোকান",
        phone: "01700000091",
      }),
    );
  });
  it("rejects a whole address book without writing a contact", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ContactImport onPick={onPick} />);
    const file = new File([""], "contacts.vcf", { type: "text/vcard" });
    Object.defineProperty(file, "text", {
      value: async () =>
        "BEGIN:VCARD\nTEL:01700000091\nEND:VCARD\nBEGIN:VCARD\nTEL:01700000092\nEND:VCARD",
    });
    await user.upload(screen.getByLabelText("কন্টাক্ট ফাইল"), file);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });
});

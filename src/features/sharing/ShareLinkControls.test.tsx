// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareLinkControls } from "./ShareLinkControls";
const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  status: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  notify: vi.fn(),
}));
vi.mock("../../app/NotebookProvider", () => ({
  useNotebook: () => ({
    mode: "real",
    state: { sync: mocks.sync },
    notify: mocks.notify,
  }),
}));
vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (text: string) => text }),
}));
vi.mock("./shareClient", () => ({
  shareStatus: mocks.status,
  createShare: mocks.create,
  revokeShare: mocks.revoke,
  liveShareUrl: (token: string) => `http://localhost/shared#${token}`,
}));
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.status.mockResolvedValue(null);
});
afterEach(cleanup);
describe("owner live sharing controls", () => {
  it("does not create a link when local entries have not synced", async () => {
    mocks.sync.mockResolvedValue({ status: "conflict" });
    const user = userEvent.setup();
    render(
      <ShareLinkControls scope={{ personId: "worker", account: "labour" }} />,
    );
    const button = await screen.findByRole("button", { name: "লিংক তৈরি করি" });
    await user.click(button);
    await screen.findByRole("alert");
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("creates only the requested scope after syncing, then revokes it", async () => {
    mocks.sync.mockResolvedValue({ status: "synced" });
    mocks.create.mockResolvedValue({
      id: "id",
      token: "token",
      createdAt: "2026-11-01T12:00:00Z",
    });
    mocks.revoke.mockResolvedValue(undefined);
    const scope = {
      personId: "worker",
      account: "labour" as const,
      workId: "tiles",
    };
    const user = userEvent.setup();
    render(<ShareLinkControls scope={scope} />);
    await user.click(
      await screen.findByRole("button", { name: "লিংক তৈরি করি" }),
    );
    await screen.findByDisplayValue("http://localhost/shared#token");
    expect(mocks.create).toHaveBeenCalledWith(scope);
    await user.click(screen.getByRole("button", { name: "লিংক বন্ধ করি" }));
    await screen.findByRole("button", { name: "লিংক তৈরি করি" });
    expect(mocks.revoke).toHaveBeenCalledWith("id");
    expect(
      screen.queryByDisplayValue("http://localhost/shared#token"),
    ).toBeNull();
  });
});

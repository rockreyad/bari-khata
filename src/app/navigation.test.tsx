// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import {
  HouseLineIcon,
  NotebookIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { NotebookNavLink, notebookSectionActive } from "./navigation";
vi.mock("../context/LanguageProvider", () => ({
  useLanguageContext: () => ({ t: (text: string) => text }),
}));
afterEach(cleanup);
describe("notebook navigation", () => {
  it.each([
    ["/", "", "/", true],
    ["/sample", "/sample", "/", true],
    ["/sample/", "/sample", "/", true],
    ["/dues", "", "/", true],
    ["/dues/", "", "/", true],
    ["/sample/dues", "/sample", "/", true],
    ["/sample/dues/", "/sample", "/", true],
    ["/dues/nonsense", "", "/", false],
    ["/dues-other", "", "/", false],
    ["/sample/sectors/door", "/sample", "/sectors", true],
    ["/sectors/door", "", "/sectors", true],
    ["/parties/shah-alam", "", "/parties", true],
    ["/works", "", "/works", true],
    ["/sample/works/job-one", "/sample", "/works", true],
    ["/jobs-other", "", "/parties", false],
    ["/materials/cement", "", "/reports", true],
    ["/sample/review", "/sample", "/ledger", true],
    ["/settings/appearance", "", "/settings", true],
    ["/sample/settings/appearance", "/sample", "/settings", true],
    ["/sample/settings/appearance", "/sample", "/", false],
    ["/settings-appearance", "", "/settings", false],
    ["/people-other", "", "/parties", false],
    ["/sectors", "", "/", false],
    ["/write/payment", "", "/write", true],
    ["/sample/history", "/sample", "/ledger", true],
    ["/settings/appearance", "", "/settings", true],
    ["/reports", "", "/reports", true],
  ])("matches %s under %s to %s", (path, base, section, expected) => {
    expect(notebookSectionActive(path, base, section)).toBe(expected);
  });
  it("moves the active label and duotone icon after navigating, including sample root without a slash", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/sample"]}>
        <nav>
          <NotebookNavLink
            to="/"
            base="/sample"
            label="এক নজরে"
            icon={HouseLineIcon}
          />
          <NotebookNavLink
            to="/sectors"
            base="/sample"
            label="কাজের খাতা"
            icon={NotebookIcon}
          />
          <NotebookNavLink
            to="/parties"
            base="/sample"
            label="ব্যক্তি ও দোকান"
            icon={UsersThreeIcon}
          />
        </nav>
      </MemoryRouter>,
    );
    const overview = screen.getByRole("link", { name: "এক নজরে" });
    const work = screen.getByRole("link", { name: "কাজের খাতা" });
    expect(overview.getAttribute("aria-current")).toBe("page");
    const activeHome = overview.querySelector("svg")!.innerHTML;
    expect(overview.querySelector("svg")!.getAttribute("aria-hidden")).toBe(
      "true",
    );
    await user.click(work);
    expect(overview.getAttribute("aria-current")).toBeNull();
    expect(work.getAttribute("aria-current")).toBe("page");
    expect(work.className).toBe("active");
    expect(overview.querySelector("svg")!.innerHTML).not.toBe(activeHome);
    await user.click(screen.getByRole("link", { name: "ব্যক্তি ও দোকান" }));
    expect(work.getAttribute("aria-current")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "ব্যক্তি ও দোকান" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

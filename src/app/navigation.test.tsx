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
    ["/sample/works/door", "/sample", "/works", true],
    ["/works/door", "", "/works", true],
    ["/people/shah-alam", "", "/people", true],
    ["/jobs", "", "/people", true],
    ["/sample/jobs/job-one", "/sample", "/people", true],
    ["/jobs-other", "", "/people", false],
    ["/materials/cement", "", "/reports", true],
    ["/sample/review", "/sample", "/ledger", true],
    ["/people-other", "", "/people", false],
    ["/works", "", "/", false],
  ])("matches %s under %s to %s", (path, base, section, expected) => {
    expect(notebookSectionActive(path, base, section)).toBe(expected);
  });
  it("moves the active label and filled icon after navigating, including sample root without a slash", async () => {
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
            to="/works"
            base="/sample"
            label="কাজের খাতা"
            icon={NotebookIcon}
          />
          <NotebookNavLink
            to="/people"
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
    const filledHome = overview.querySelector("svg")!.innerHTML;
    await user.click(work);
    expect(overview.getAttribute("aria-current")).toBeNull();
    expect(work.getAttribute("aria-current")).toBe("page");
    expect(work.className).toBe("active");
    expect(overview.querySelector("svg")!.innerHTML).not.toBe(filledHome);
    await user.click(screen.getByRole("link", { name: "ব্যক্তি ও দোকান" }));
    expect(work.getAttribute("aria-current")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "ব্যক্তি ও দোকান" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });
});

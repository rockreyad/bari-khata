// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SharedContractCarousel } from "./SharedContractCarousel";
import type { SharedStatement } from "./shareModel";

vi.mock("../../context/LanguageProvider", () => ({
  useLanguageContext: () => ({
    t: (text: string) => text,
    money: (value: number) => `৳${value / 100}`,
    formatDigits: (value: string | number) => String(value),
  }),
}));

afterEach(cleanup);
const contracts = (count: number): SharedStatement["contracts"] =>
  Array.from({ length: count }, (_, index) => ({
    title: `নমুনা কাজ ${index + 1}`,
    workName: "নমুনা ছাদ",
    total: 100000,
    netPaid: 20000,
    remaining: 10000,
    remainingCommitment: 80000,
    unearnedCommitment: 70000,
    status: "ongoing",
  }));

describe("shared work cards", () => {
  it("shows the contract total directly while keeping earned due distinct", () => {
    render(
      <SharedContractCarousel contracts={contracts(1)} ambiguous={false} />,
    );
    const card = screen.getByRole("article", { name: "নমুনা কাজ 1" });
    const balances = card.querySelector<HTMLElement>(
      ".shared-contract-balances",
    )!;
    expect(
      within(balances).getByText("পেয়েছেন").parentElement?.textContent,
    ).toBe("পেয়েছেন৳200");
    expect(
      within(balances).getByText("আর পাবেন").parentElement?.textContent,
    ).toBe("আর পাবেন৳100");
    expect(balances.textContent).not.toContain("৳800");
    expect(
      within(balances).getByText("চুক্তির মোট").parentElement?.textContent,
    ).toBe("চুক্তির মোট৳1000");
    expect(card.querySelector("details")).toBeNull();
    expect(screen.queryByText("চুক্তির বিস্তারিত")).toBeNull();
    expect(screen.queryByText("এখনও বিল হয়নি")).toBeNull();
  });

  it("suppresses an unresolved earned balance in every card", () => {
    const { container } = render(
      <SharedContractCarousel contracts={contracts(2)} ambiguous />,
    );
    for (const balances of container.querySelectorAll<HTMLElement>(
      ".shared-contract-balances",
    )) {
      expect(within(balances).getByText("বাকি মেলানো বাকি")).toBeTruthy();
      expect(within(balances).queryByText("৳100")).toBeNull();
      expect(within(balances).getByText("৳200")).toBeTruthy();
    }
  });

  it("keeps every work card in one continuous track without arrows or pagination", () => {
    const { container } = render(
      <SharedContractCarousel contracts={contracts(11)} ambiguous={false} />,
    );
    const track = screen.getByRole("group", { name: "কাজের কার্ড" });
    expect(within(track).getAllByRole("article")).toHaveLength(11);
    expect(
      within(track).getByRole("article", { name: "নমুনা কাজ 11" }),
    ).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText("পাশে টেনে আরও কাজ দেখুন")).toBeNull();
    expect(screen.queryByText("নমুনা ছাদ")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    fireEvent.scroll(track, { target: { scrollLeft: 1400 } });
    expect(within(track).getAllByRole("article")).toHaveLength(11);
    expect(
      within(track).getByRole("article", { name: "নমুনা কাজ 1" }),
    ).toBeTruthy();
  });

  it("lets keyboard users focus the native scroll region", async () => {
    const user = userEvent.setup();
    render(
      <SharedContractCarousel contracts={contracts(3)} ambiguous={false} />,
    );
    const track = screen.getByRole("group", { name: "কাজের কার্ড" });
    await user.tab();
    expect(document.activeElement).toBe(track);
    expect(fireEvent.keyDown(track, { key: "ArrowRight" })).toBe(true);
  });

  it("puts ongoing work first, orders each group by total, and preserves ties and source data", () => {
    const work = contracts(7);
    const cases = [
      { status: "done", total: 9000000 },
      { status: "ongoing", total: 10000 },
      { status: "planned", total: 90000 },
      { status: "ongoing", total: 20000 },
      { status: "ongoing", total: 20000 },
      { status: null, total: 400000 },
      { status: undefined, total: 90000 },
    ] as const;
    for (const [index, values] of cases.entries())
      work[index] = { ...work[index], ...values };
    const before = work.map((contract) => ({ ...contract }));

    render(<SharedContractCarousel contracts={work} ambiguous={false} />);

    expect(
      screen
        .getAllByRole("article")
        .map((card) => within(card).getByRole("heading").textContent),
    ).toEqual([4, 5, 2, 1, 6, 3, 7].map((index) => `নমুনা কাজ ${index}`));
    expect(work).toEqual(before);
  });

  it.each([
    ["planned", "শুরু হয়নি"],
    ["ongoing", "চলছে"],
    ["done", "শেষ"],
    [null, "অবস্থা লেখা নেই"],
    [undefined, "অবস্থা পাওয়া যায়নি"],
  ] as const)(
    "shows the recorded %s status without inferring it from payment",
    (status, label) => {
      const work = contracts(1);
      work[0] = { ...work[0], status, netPaid: work[0].total, remaining: 0 };
      const { container } = render(
        <SharedContractCarousel contracts={work} ambiguous={false} />,
      );
      expect(container.querySelector(".shared-work-status")?.textContent).toBe(
        label,
      );
      expect(screen.queryByText("চুক্তির বিস্তারিত")).toBeNull();
    },
  );

  it("does not render an empty work section", () => {
    const { container } = render(
      <SharedContractCarousel contracts={[]} ambiguous={false} />,
    );
    expect(container.childElementCount).toBe(0);
  });
});

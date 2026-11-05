import { describe, expect, it } from "vitest";
import { reportCashAccount, reportMode } from "./reportMode";

describe("report mode", () => {
  it.each([
    ["", "", "cash"],
    ["work=roof&person=worker&account=labour", "", "cash"],
    ["mode=cost", "", "cost"],
    ["section=labour", "", "cost"],
    ["type=labour", "", "cost"],
    ["group=cement", "", "cost"],
    ["item=cement", "", "cost"],
    ["brand=sample", "", "cost"],
    ["usage=wall", "", "cost"],
    ["section=", "", "cost"],
    ["", "cement", "cost"],
    ["mode=cash&section=labour&type=labour", "", "cash"],
    ["mode=cash&group=cement&brand=sample&item=cement", "cement", "cash"],
    ["mode=unknown", "", "cash"],
    ["mode=unknown&section=material", "", "cost"],
  ] as const)(
    "resolves %s with initial group %s to %s",
    (query, group, mode) => {
      const params = new URLSearchParams(query);
      const before = params.toString();
      expect(reportMode(params, group)).toBe(mode);
      expect(params.toString()).toBe(before);
    },
  );
});

describe("cash account scope", () => {
  it.each([
    ["", undefined],
    ["work=roof&person=worker", undefined],
    ["account=materials&section=labour", "materials"],
    ["account=labour&section=material", "labour"],
    ["account=other&section=labour", "other"],
    ["mode=cash&section=labour", "labour"],
    ["mode=cash&section=material", "materials"],
    ["mode=cash&type=labour", "labour"],
    ["mode=cash&type=material", "materials"],
    ["account=invalid&section=labour", "labour"],
    ["section=invalid&type=labour", "labour"],
    ["section=material&type=labour", "materials"],
    ["section=labour&type=material", "labour"],
    ["section=all&type=labour", undefined],
    ["section=transport&type=labour", undefined],
    ["section=other&type=material", undefined],
    ["type=transport", undefined],
    ["type=unload", undefined],
    ["type=rental", undefined],
    ["type=other", undefined],
    ["section=invalid&type=invalid&account=invalid", undefined],
  ] as const)(
    "resolves %s without broadening its account",
    (query, account) => {
      const params = new URLSearchParams(query);
      const before = params.toString();
      expect(reportCashAccount(params)).toBe(account);
      expect(params.toString()).toBe(before);
    },
  );
});

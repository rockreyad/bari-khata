import { describe, expect, it } from "vitest";
import { contractUrl, entryReturn, entryUrl, isEntryPage } from "./entryRoutes";

const parsed = (path: string) => new URL(path, "https://bari.invalid");

describe("safe entry return routes", () => {
  it.each([
    undefined,
    null,
    "",
    "https://outside.test/people/shop",
    "javascript:alert(1)",
    "//outside.test/people/shop",
    "/\\outside.test/people/shop",
    "/login",
    "/login?back=/people/shop",
    "/people/shop/../../../login",
    "/entries/new",
    "/entries/bill/edit",
    "/contracts/new",
    "/contracts/c/edit",
    "/works/door/../../entries/new",
    "/sample/people/shop",
    "/reconcile",
    "/reconcile?person=shop",
  ])("rejects unsafe or circular real-account return %s", (path) => {
    expect(entryReturn(path)).toBe("/");
  });
  it.each([
    "/people/shop",
    "/sample-other/people/shop",
    "/sample/login",
    "/sample/works/door/../../login",
    "/sample/entries/new",
    "/sample/contracts/agreement/edit",
    "/sample/reconcile?person=shop",
    "//outside.test/sample/people/shop",
  ])("keeps a demo return inside the demo account for %s", (path) => {
    expect(entryReturn(path, "/sample")).toBe("/sample/");
  });
  it("retains profile, work, history and report filters while stripping every old dialog key", () => {
    for (const path of [
      "/people/shop",
      "/works/door",
      "/ledger",
      "/reports",
      "/materials",
      "/review",
      "/settings",
      "/timeline",
    ]) {
      const params = new URLSearchParams({
        work: "door",
        person: "shop",
        account: "materials",
        order: "oldest",
        from: "2026-01-01",
        q: "সিমেন্ট ১৬২",
        tab: "labour",
        page: "2",
      });
      for (const key of [
        "_add",
        "_entity",
        "_edit",
        "_entry",
        "_work",
        "_person",
        "_account",
        "_type",
        "_purpose",
        "_quick",
      ])
        params.set(key, "old-dialog");
      const result = parsed(entryReturn(`${path}?${params}`));
      expect(result.pathname).toBe(path);
      expect(Object.fromEntries(result.searchParams)).toEqual({
        work: "door",
        person: "shop",
        account: "materials",
        order: "oldest",
        from: "2026-01-01",
        q: "সিমেন্ট ১৬২",
        tab: "labour",
        page: "2",
      });
    }
    expect(
      entryReturn(
        "/sample/people/shop?work=door&account=materials&_entry=old",
        "/sample",
      ),
    ).toBe("/sample/people/shop?work=door&account=materials");
  });
});

describe("entry and contract URLs", () => {
  it("opens a real entry route with selected context and a clean profile return", () => {
    const url = parsed(
      entryUrl(
        "",
        {
          kind: "payment",
          personId: "shop",
          workId: "door",
          account: "materials",
          costType: "material",
          purpose: "advance",
        },
        "/people/shop?work=door&account=materials&_entry=bill",
      ),
    );
    expect(url.pathname).toBe("/entries/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "payment",
      back: "/people/shop?work=door&account=materials",
      person: "shop",
      work: "door",
      account: "materials",
      type: "material",
      purpose: "advance",
    });
    expect(
      [...url.searchParams.keys()].some((key) => key.startsWith("_")),
    ).toBe(false);
  });
  it("encodes entry identifiers as one edit path segment and prevents an outside return", () => {
    const url = parsed(
      entryUrl(
        "/sample",
        { editId: "bill/one?#", kind: "expense" },
        "https://outside.test/people/shop",
      ),
    );
    expect(url.pathname).toBe("/sample/entries/bill%2Fone%3F%23/edit");
    expect(url.searchParams.get("back")).toBe("/sample/");
  });
  it("opens contract creation and editing as addressable routes with work and person context", () => {
    for (const [base, id] of [
      ["", undefined],
      ["/sample", "agreement/one"],
    ] as const) {
      const url = parsed(
        contractUrl(
          base,
          id,
          "door",
          "worker",
          `${base}/people/worker?work=door&account=labour&_entity=contract`,
        ),
      );
      expect(url.pathname).toBe(
        id ? "/sample/jobs/agreement%2Fone/edit" : "/jobs/new",
      );
      expect(Object.fromEntries(url.searchParams)).toEqual({
        back: `${base}/people/worker?work=door&account=labour`,
        work: "door",
        person: "worker",
      });
      expect(
        [...url.searchParams.keys()].some((key) => key.startsWith("_")),
      ).toBe(false);
    }
  });
});

it("returns job edits and payments to the same job detail, never to another form", () => {
  expect(
    entryReturn("/sample/jobs/job-one?tab=history&_entry=old", "/sample"),
  ).toBe("/sample/jobs/job-one?tab=history");
  expect(entryReturn("/jobs?person=worker&work=door")).toBe(
    "/jobs?person=worker&work=door",
  );
  for (const path of ["/jobs/new", "/jobs/job-one/edit"])
    expect(entryReturn(path)).toBe("/");
  const url = parsed(
    entryUrl(
      "/sample",
      {
        kind: "payment",
        personId: "worker",
        account: "labour",
        contractId: "job-one",
      },
      "/sample/jobs/job-one",
    ),
  );
  expect(url.searchParams.get("contract")).toBe("job-one");
  expect(url.searchParams.get("back")).toBe("/sample/jobs/job-one");
});
it("treats only job creation and editing as an entry page", () => {
  for (const path of [
    "/jobs/new",
    "/sample/jobs/one/edit",
    "/contracts/one/edit",
    "/entries/new",
  ])
    expect(isEntryPage(path)).toBe(true);
  for (const path of [
    "/jobs",
    "/sample/jobs/one",
    "/people/worker",
    "/works/door",
  ])
    expect(isEntryPage(path)).toBe(false);
});

import { describe, expect, it } from "vitest";
import {
  contractUrl,
  personUrl,
  entryReturn,
  entryUrl,
  isEntryPage,
  sectorUrl,
} from "./entryRoutes";

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
    "/login?back=/parties/shop",
    "/parties/shop/../../../login",
    "/entries/new",
    "/entries/bill/edit",
    "/contracts/new",
    "/contracts/c/edit",
    "/parties/new",
    "/parties/shop/edit",
    "/parties/shop/edit/",
    "/sectors/door/../../entries/new",
    "/sample/parties/shop",
    "/reconcile",
    "/reconcile?person=shop",
    "/dues/nonsense",
    "/dues-other",
  ])("rejects unsafe or circular real-account return %s", (path) => {
    expect(entryReturn(path)).toBe("/");
  });
  it.each([
    "/parties/shop",
    "/sample-other/people/shop",
    "/sample/login",
    "/sample/sectors/door/../../login",
    "/sample/entries/new",
    "/sample/contracts/agreement/edit",
    "/sample/parties/new",
    "/sample/parties/shop/edit",
    "/sample/reconcile?person=shop",
    "/sample/dues/nonsense",
    "//outside.test/sample/parties/shop",
  ])("keeps a demo return inside the demo account for %s", (path) => {
    expect(entryReturn(path, "/sample")).toBe("/sample/");
  });
  it("retains profile, work, history and report filters while stripping every old dialog key", () => {
    for (const path of [
      "/parties/shop",
      "/sectors/door",
      "/ledger",
      "/reports",
      "/materials",
      "/review",
      "/settings",
      "/timeline",
      "/dues",
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
        "/sample/parties/shop?work=door&account=materials&_entry=old",
        "/sample",
      ),
    ).toBe("/sample/parties/shop?work=door&account=materials");
  });
  it.each(["", "/sample"])(
    "preserves the dues page and pagination while removing bill details under %s",
    (base) => {
      expect(entryReturn(`${base}/dues?page=2&_entry=bill`, base)).toBe(
        `${base}/dues?page=2`,
      );
      expect(entryReturn(`${base}/dues/?page=2&_entry=bill`, base)).toBe(
        `${base}/dues/?page=2`,
      );
      const url = parsed(
        entryUrl(base, { editId: "bill" }, `${base}/dues?page=2&_entry=bill`),
      );
      expect(url.searchParams.get("back")).toBe(`${base}/dues?page=2`);
    },
  );
});

describe("entry and contract URLs", () => {
  it.each(["", "/sample"])(
    "opens person pages with a safe return and the same legacy draft context under %s",
    (base) => {
      const back = `${base}/parties?kind=shop&q=সিমেন্ট&_entity=person&_edit=old&_work=door`;
      for (const id of [undefined, "person/one?#"]) {
        const url = parsed(personUrl(base, id, "door", "legacy-context", back));
        expect(url.pathname).toBe(
          `${base}/parties/${id ? "person%2Fone%3F%23/edit" : "new"}`,
        );
        expect(Object.fromEntries(url.searchParams)).toEqual({
          back: `${base}/parties?kind=shop&q=${encodeURIComponent("সিমেন্ট")}`,
          work: "door",
          person: "legacy-context",
        });
      }
      expect(parsed(personUrl(base)).searchParams.get("back")).toBe(
        `${base}/parties`,
      );
      expect(
        parsed(
          personUrl(base, "shop", undefined, undefined, `${base}/parties/new`),
        ).searchParams.get("back"),
      ).toBe(`${base}/`);
    },
  );
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
        "/parties/shop?work=door&account=materials&_entry=bill",
      ),
    );
    expect(url.pathname).toBe("/entries/new");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "payment",
      back: "/parties/shop?work=door&account=materials",
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
          `${base}/parties/worker?work=door&account=labour&_entity=contract`,
        ),
      );
      expect(url.pathname).toBe(
        id ? "/sample/works/agreement%2Fone/edit" : "/works/new",
      );
      expect(Object.fromEntries(url.searchParams)).toEqual({
        back: `${base}/parties/worker?work=door&account=labour`,
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
    entryReturn("/sample/works/job-one?tab=history&_entry=old", "/sample"),
  ).toBe("/sample/works/job-one?tab=history");
  expect(entryReturn("/works?person=worker&work=door")).toBe(
    "/works?person=worker&work=door",
  );
  for (const path of ["/works/new", "/works/job-one/edit"])
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
      "/sample/works/job-one",
    ),
  );
  expect(url.searchParams.get("contract")).toBe("job-one");
  expect(url.searchParams.get("back")).toBe("/sample/works/job-one");
});
it("treats entry, job and person creation or editing as a form page", () => {
  for (const path of [
    "/works/new",
    "/sample/works/one/edit",
    "/contracts/one/edit",
    "/entries/new",
    "/parties/new",
    "/sample/parties/shop/edit",
  ])
    expect(isEntryPage(path)).toBe(true);
  for (const path of [
    "/works",
    "/sample/works/one",
    "/parties/worker",
    "/sectors/door",
    "/dues",
    "/sample/dues",
  ])
    expect(isEntryPage(path)).toBe(false);
});

it.each(["", "/sample"])(
  "normalizes unambiguous legacy party/work aliases without losing query or fragment under %s",
  (base) => {
    expect(entryReturn(`${base}/people/shop?work=door#bill`, base)).toBe(
      `${base}/parties/shop?work=door#bill`,
    );
    expect(entryReturn(`${base}/jobs/job?tab=history#change`, base)).toBe(
      `${base}/works/job?tab=history#change`,
    );
    expect(entryReturn(`${base}/contracts/job?tab=history`, base)).toBe(
      `${base}/works/job?tab=history`,
    );
    const sector = parsed(
      sectorUrl(base, "door/one", `${base}/sectors?status=done#list`),
    );
    expect(sector.pathname).toBe(`${base}/sectors/door%2Fone/edit`);
    expect(sector.searchParams.get("back")).toBe(
      `${base}/sectors?status=done#list`,
    );
    expect(entryReturn(`${base}/sectors/new`, base)).toBe(`${base}/`);
    expect(entryReturn(`${base}/works/new`, base)).toBe(`${base}/`);
  },
);

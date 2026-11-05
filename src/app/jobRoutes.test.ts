import { describe, expect, it } from "vitest";
import { jobDetailUrl, jobReturn } from "./jobRoutes";

describe("contextual job navigation", () => {
  it.each(["", "/sample"])(
    "preserves person, notebook and list filters under %s",
    (base) => {
      for (const origin of [
        "/parties/worker?account=labour&work=door",
        "/sectors/door?tab=labour",
        "/works?person=worker&status=done&balance=due&q=দরজা",
        "/parties?q=মিস্ত্রি",
        "/",
      ]) {
        const url = new URL(
          jobDetailUrl("job/one", `${base}${origin}`, base),
          "https://bari.invalid",
        );
        expect(url.pathname).toBe("/works/job%2Fone");
        expect(jobReturn(url.searchParams.get("back"), base)).toBe(
          origin.includes("q=")
            ? `${new URL(origin, "https://bari.invalid").pathname}${new URL(origin, "https://bari.invalid").search}`
            : origin,
        );
      }
    },
  );

  it.each([
    "https://outside.test/people/me",
    "//outside.test",
    "/\\outside.test/people/me",
    "/works/job-one",
    "/works/job-one/edit",
    "/entries/new",
    "/parties/new",
    "/parties/new/",
    "/parties/worker/edit",
    "/works/new",
    "/login",
    "/sample/parties/me",
    "/sectors/door/../../login",
  ])("rejects unsafe or looping real origins %s", (origin) => {
    expect(jobReturn(origin, "", "/parties/worker")).toBe("/parties/worker");
  });
  it.each([
    "/parties/me",
    "/sample-other/people/me",
    "/sample/works/job-one",
    "/sample/entries/new",
    "/sample/parties/new",
    "/sample/parties/worker/edit",
  ])("keeps demo account boundaries for %s", (origin) => {
    expect(jobReturn(origin, "/sample", "/parties/worker")).toBe(
      "/parties/worker",
    );
  });
  it("strips old overlays without dropping useful filters and survives reloading the detail URL", () => {
    const full = jobDetailUrl(
      "job-one",
      "/sample/parties/worker?work=door&_entry=old&_quick=1",
      "/sample",
    );
    const reloaded = new URL(full, "https://bari.invalid");
    reloaded.searchParams.set("tab", "history");
    expect(jobReturn(reloaded.searchParams.get("back"), "/sample")).toBe(
      "/parties/worker?work=door",
    );
    expect(jobReturn(null, "/sample")).toBe("/works");
  });
  it.each(["", "/sample"])(
    "never creates a job-detail return to a person form under %s",
    (base) => {
      for (const form of ["/parties/new", "/parties/worker/edit"]) {
        const url = new URL(
          jobDetailUrl("job-one", `${base}${form}`, base),
          "https://bari.invalid",
        );
        expect(url.searchParams.get("back")).toBe(`${base}/works`);
        expect(jobReturn(`${base}${form}`, base)).toBe("/works");
      }
    },
  );
});

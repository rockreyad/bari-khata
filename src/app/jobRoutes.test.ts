import { describe, expect, it } from "vitest";
import { jobDetailUrl, jobReturn } from "./jobRoutes";

describe("contextual job navigation", () => {
  it.each(["", "/sample"])(
    "preserves person, notebook and list filters under %s",
    (base) => {
      for (const origin of [
        "/people/worker?account=labour&work=door",
        "/works/door?tab=labour",
        "/jobs?person=worker&status=done&balance=due&q=দরজা",
        "/people?q=মিস্ত্রি",
        "/",
      ]) {
        const url = new URL(
          jobDetailUrl("job/one", `${base}${origin}`, base),
          "https://bari.invalid",
        );
        expect(url.pathname).toBe("/jobs/job%2Fone");
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
    "/jobs/job-one",
    "/jobs/job-one/edit",
    "/entries/new",
    "/jobs/new",
    "/login",
    "/sample/people/me",
    "/works/door/../../login",
  ])("rejects unsafe or looping real origins %s", (origin) => {
    expect(jobReturn(origin, "", "/people/worker")).toBe("/people/worker");
  });
  it.each([
    "/people/me",
    "/sample-other/people/me",
    "/sample/jobs/job-one",
    "/sample/entries/new",
  ])("keeps demo account boundaries for %s", (origin) => {
    expect(jobReturn(origin, "/sample", "/people/worker")).toBe(
      "/people/worker",
    );
  });
  it("strips old overlays without dropping useful filters and survives reloading the detail URL", () => {
    const full = jobDetailUrl(
      "job-one",
      "/sample/people/worker?work=door&_entry=old&_quick=1",
      "/sample",
    );
    const reloaded = new URL(full, "https://bari.invalid");
    reloaded.searchParams.set("tab", "history");
    expect(jobReturn(reloaded.searchParams.get("back"), "/sample")).toBe(
      "/people/worker?work=door",
    );
    expect(jobReturn(null, "/sample")).toBe("/jobs");
  });
});

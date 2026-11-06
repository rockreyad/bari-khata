import { expect, it } from "vitest";
import { checkPwaBuild } from "./checkPwaBuild";
import { serviceWorkerSource } from "./serviceWorker";

const build = "0123456789abcdef";
const html = `<head><meta name="bari-build" content="${build}" /></head>`;
const policy = { latestVersion: "0.1.4", minimumSupportedVersion: "0.1.4" };
const worker = serviceWorkerSource(build, [
  "/index.html",
  "/assets/current.js",
]);

it("accepts emitted matching document and worker IDs with an uncached release manifest", () => {
  expect(() => checkPwaBuild(html, worker, policy, policy)).not.toThrow();
});

it("fails the build when HTML emission skipped the handshake or mismatched the worker", () => {
  for (const document of [
    "<head></head>",
    html.replace(build, "fedcba9876543210"),
    html + html,
  ])
    expect(() => checkPwaBuild(document, worker, policy, policy)).toThrow(
      "matching build ID",
    );
});

it("rejects a cached or stale release policy in emitted artifacts", () => {
  expect(() =>
    checkPwaBuild(
      html,
      serviceWorkerSource(build, ["/index.html", "/release.json"]),
      policy,
      policy,
    ),
  ).toThrow("exclude release.json");
  expect(() =>
    checkPwaBuild(html, worker, { ...policy, latestVersion: "0.1.3" }, policy),
  ).toThrow("release manifest");
});

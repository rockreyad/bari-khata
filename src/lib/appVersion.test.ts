import { expect, it } from "vitest";
import packageFile from "../../package.json";
import { APP_VERSION } from "./appVersion";

it("uses the package release version in the app build", () => {
  expect(APP_VERSION).toBe(packageFile.version);
});

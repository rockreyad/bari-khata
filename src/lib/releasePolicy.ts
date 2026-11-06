import { z } from "zod";
import { APP_VERSION } from "./appVersion";
import configuredPolicy from "../../release-policy.json";
import { setFinancialWritesAllowed } from "./localWriteBarrier";

export const VersionSchema = z
  .string()
  .max(64)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .refine((value) =>
    value.split(".").every((part) => Number.isSafeInteger(Number(part))),
  );

export function compareVersions(first: string, second: string) {
  const a = VersionSchema.parse(first).split(".").map(Number);
  const b = VersionSchema.parse(second).split(".").map(Number);
  for (let index = 0; index < 3; index++)
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  return 0;
}

export const ReleasePolicySchema = z
  .object({
    latestVersion: VersionSchema,
    minimumSupportedVersion: VersionSchema,
  })
  .strict()
  .refine(
    (value) =>
      compareVersions(value.minimumSupportedVersion, value.latestVersion) <= 0,
  );

export type ReleasePolicy = z.infer<typeof ReleasePolicySchema>;
export type ReleaseState = ReleasePolicy & { required: boolean };
const listeners = new Set<() => void>();
let serverMinimum: string | null = null;
let serverRejected = false;
let state: ReleaseState = {
  latestVersion: APP_VERSION,
  minimumSupportedVersion: configuredPolicy.minimumSupportedVersion,
  required:
    compareVersions(APP_VERSION, configuredPolicy.minimumSupportedVersion) < 0,
};

function publish(policy: ReleasePolicy) {
  if (
    compareVersions(
      state.minimumSupportedVersion,
      policy.minimumSupportedVersion,
    ) > 0
  )
    policy = {
      ...policy,
      minimumSupportedVersion: state.minimumSupportedVersion,
    };
  const minimumSupportedVersion =
    serverMinimum &&
    compareVersions(serverMinimum, policy.minimumSupportedVersion) > 0
      ? serverMinimum
      : policy.minimumSupportedVersion;
  const latestVersion =
    compareVersions(policy.latestVersion, minimumSupportedVersion) < 0
      ? minimumSupportedVersion
      : policy.latestVersion;
  const required =
    serverRejected || compareVersions(APP_VERSION, minimumSupportedVersion) < 0;
  if (
    state.latestVersion === latestVersion &&
    state.minimumSupportedVersion === minimumSupportedVersion &&
    state.required === required
  )
    return;
  state = { latestVersion, minimumSupportedVersion, required };
  setFinancialWritesAllowed(!required);
  for (const listener of listeners) listener();
}

setFinancialWritesAllowed(!state.required);
export const getReleaseState = () => state;
export function subscribeReleasePolicy(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let request: Promise<void> | null = null;
let lastCheck = 0;
export function checkReleasePolicy(force = false): Promise<void> {
  if (request) return request;
  if (!force && Date.now() - lastCheck < 60_000) return Promise.resolve();
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return Promise.resolve();
  lastCheck = Date.now();
  request = Promise.resolve()
    .then(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/release.json", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        publish(ReleasePolicySchema.parse(await response.json()));
      } catch {
        // A failed check never erases a known minimum or the local offline copy.
      } finally {
        clearTimeout(timeout);
      }
    })
    .finally(() => {
      request = null;
    });
  return request;
}

export function reportClientUpdateRequired(error: unknown) {
  const result = z
    .object({
      code: z.string().optional(),
      message: z.string(),
      details: z.unknown().optional(),
    })
    .safeParse(error);
  if (
    !result.success ||
    (result.data.code !== "PT426" &&
      result.data.message !== "client_update_required")
  )
    return false;
  serverRejected = true;
  try {
    const details =
      typeof result.data.details === "string"
        ? JSON.parse(result.data.details)
        : result.data.details;
    const parsed = z
      .object({ minimumSupportedVersion: VersionSchema })
      .parse(details);
    serverMinimum = parsed.minimumSupportedVersion;
    publish({
      latestVersion: state.latestVersion,
      minimumSupportedVersion: serverMinimum,
    });
  } catch {
    // This release is the minimum advertised by the matching server migration.
    serverMinimum = configuredPolicy.minimumSupportedVersion;
    publish({
      latestVersion: state.latestVersion,
      minimumSupportedVersion: serverMinimum,
    });
  }
  return true;
}

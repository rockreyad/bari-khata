import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { parseEnv } from "node:util";
import { enableLocalPhoneProvider } from "./enable-local-phone-provider.mjs";

const mode = process.argv[2] ?? "mock";
if (!["mock", "sms", "off"].includes(mode))
  throw new Error("Choose mock, sms or off.");
const path = ".env.local";
let source = "";
try {
  source = await readFile(path, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const previous = parseEnv(source);
const changes = { BARI_PHONE_AUTH_MODE: mode };
if (mode === "mock") {
  const status = JSON.parse(
    execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  if (
    !/^http:\/\/(127\.0\.0\.1|localhost):55431$/.test(status.API_URL ?? "") ||
    !status.SERVICE_ROLE_KEY
  )
    throw new Error(
      "Only the local Bari Khata backend on port55431 can use fixed OTP.",
    );
  if (
    previous.VITE_SUPABASE_URL &&
    !/^http:\/\/(127\.0\.0\.1|localhost):55431\/?$/.test(
      previous.VITE_SUPABASE_URL,
    )
  )
    throw new Error("Refusing to configure fixed OTP for a hosted backend.");
  const otp =
    process.env.BARI_DEV_PHONE_OTP || previous.BARI_DEV_PHONE_OTP || "1318";
  if (!/^\d{4,8}$/.test(otp))
    throw new Error("The local OTP must contain4to8digits.");
  if (
    previous.BARI_DEV_PHONE_AUTH_SECRET &&
    previous.BARI_DEV_PHONE_AUTH_SECRET.length < 32
  )
    throw new Error(
      "The existing private phone key must contain at least32characters; it was not replaced.",
    );
  Object.assign(changes, {
    VITE_SUPABASE_URL: previous.VITE_SUPABASE_URL || status.API_URL,
    VITE_SUPABASE_ANON_KEY: previous.VITE_SUPABASE_ANON_KEY || status.ANON_KEY,
    BARI_DEV_PHONE_OTP: otp,
    BARI_DEV_PHONE_AUTH_SECRET:
      previous.BARI_DEV_PHONE_AUTH_SECRET || randomBytes(32).toString("hex"),
    BARI_DEV_SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  });
}
for (const [key, value] of Object.entries(changes)) {
  const line = `${key}=${JSON.stringify(value)}`;
  const expression = new RegExp(`^${key}=.*$`, "m");
  source = expression.test(source)
    ? source.replace(expression, () => line)
    : `${source.trimEnd()}\n${line}\n`;
}
await writeFile(path, source, { mode: 0o600 });
await chmod(path, 0o600);
if (mode === "mock") await enableLocalPhoneProvider();
console.log(
  `Phone authentication mode configured: ${mode}. Restart the dev/preview server to apply it. Private values were not printed.`,
);

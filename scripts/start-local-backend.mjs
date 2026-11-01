import { execFileSync } from "node:child_process";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { enableLocalPhoneProvider } from "./enable-local-phone-provider.mjs";

await mkdir("private", { recursive: true, mode: 0o700 });
let output;
try {
  output = execFileSync("./node_modules/.bin/supabase", ["start"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4000000,
  });
} catch (error) {
  await writeFile(
    "private/local-backend-start.log",
    String(error.stdout ?? "") + String(error.stderr ?? ""),
    { mode: 0o600 },
  );
  await chmod("private/local-backend-start.log", 0o600);
  throw new Error(
    "Local backend startup failed. Diagnostics were saved privately.",
  );
}
await writeFile("private/local-backend-start.log", output, { mode: 0o600 });
await chmod("private/local-backend-start.log", 0o600);
await enableLocalPhoneProvider();
console.log(
  "Local backend is ready. API: http://127.0.0.1:55431; test email: http://127.0.0.1:55434. Private service keys were not printed.",
);

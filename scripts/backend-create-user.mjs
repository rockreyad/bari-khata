import { execFileSync } from "node:child_process";

const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: node scripts/backend-create-user.mjs your@email.com");
  console.error(
    "Enter a password through stdin; it is never printed or passed as a command argument.",
  );
  process.exit(1);
}

async function readPassword() {
  if (!process.stdin.isTTY) {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    return input.replace(/\r?\n$/, "");
  }
  process.stderr.write("Password (hidden): ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let password = "";
  return new Promise((resolve, reject) => {
    function finish() {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", read);
      process.stderr.write("\n");
    }
    function read(chunk) {
      for (const char of chunk.toString()) {
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          resolve(password);
          return;
        }
        if (char === "\u007f" || char === "\b")
          password = password.slice(0, -1);
        else if (char >= " ") password += char;
      }
    }
    process.stdin.on("data", read);
  });
}

const password = await readPassword();
if (typeof password !== "string" || password.length < 10)
  throw new Error("Use a password of at least 10 characters.");
let status;
try {
  status = JSON.parse(
    execFileSync("./node_modules/.bin/supabase", ["status", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
} catch {
  throw new Error(
    "Local Supabase is unavailable. Install dependencies and run npm run db:start first.",
  );
}
if (!/^http:\/\/(127\.0\.0\.1|localhost):55431$/.test(status.API_URL ?? "")) {
  throw new Error(
    "This helper only creates accounts in the local bari-khata project.",
  );
}
const response = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: status.SERVICE_ROLE_KEY,
    Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!response.ok)
  throw new Error(
    `Could not create local account (HTTP ${response.status}). The email may already exist.`,
  );
console.log(
  "Local account created. Sign in at /login using this email and password. This account starts with an empty private notebook.",
);

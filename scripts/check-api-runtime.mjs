import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const output = await mkdtemp(path.join(tmpdir(), "bari-api-runtime-"));
function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("API runtime verification failed.");
}
try {
  // Vite resolves .ts imports that deployed native ESM cannot load.
  run([
    path.join(root, "node_modules/typescript/bin/tsc"),
    "api/phone-login.ts",
    "api/account-delete.ts",
    "api/mcp.ts",
    "api/mcp-admin.ts",
    "api/mcp-auth.ts",
    "api/mcp-file.ts",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2022",
    "--outDir",
    output,
    "--rootDir",
    root,
    "--strict",
    "--esModuleInterop",
    "--skipLibCheck",
    "--noEmit",
    "false",
    "--allowImportingTsExtensions",
    "false",
    "--types",
    "node",
  ]);
  await writeFile(path.join(output, "package.json"), '{"type":"module"}\n');
  await symlink(
    path.join(root, "node_modules"),
    path.join(output, "node_modules"),
    "dir",
  );
  const entry = pathToFileURL(path.join(output, "api/phone-login.js")).href;
  const accountEntry = pathToFileURL(
    path.join(output, "api/account-delete.js"),
  ).href;
  const mcpEntry = pathToFileURL(path.join(output, "api/mcp.js")).href;
  run(
    [
      "--input-type=module",
      "-e",
      `
  import assert from 'node:assert/strict';
  const route=await import(${JSON.stringify(entry)});
  const response=await route.default.fetch(new Request('https://bari.invalid/api/phone-login',{method:'POST'}));
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:'phone_auth_unavailable'});
  const accountRoute=await import(${JSON.stringify(accountEntry)});
  const accountResponse=await accountRoute.default.fetch(new Request('https://bari.invalid/api/account-delete',{method:'POST'}));
  assert.equal(accountResponse.status,404);
  assert.deepEqual(await accountResponse.json(),{error:'account_delete_unavailable'});
  const mcpRoute=await import(${JSON.stringify(mcpEntry)});
  const mcpResponse=await mcpRoute.default.fetch(new Request('https://bari.invalid/api/mcp',{method:'POST'}));
  assert.equal(mcpResponse.status,404);
  assert.deepEqual(await mcpResponse.json(),{error:'mcp_unavailable',available:false});
  console.log('API runtime imports verified.');
 `,
    ],
    {
      ...process.env,
      BARI_PHONE_AUTH_MODE: "off",
      BARI_MANUAL_PHONE_CODE: "",
      BARI_PHONE_AUTH_SECRET: "",
      BARI_SUPABASE_SERVICE_ROLE_KEY: "",
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
      BARI_MCP_ENABLED: "false",
    },
  );
} finally {
  await rm(output, { recursive: true, force: true });
}

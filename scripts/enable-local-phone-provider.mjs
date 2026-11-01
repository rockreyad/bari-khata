import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { request } from "node:http";
import { readFile, mkdir, writeFile, unlink, chmod } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function enableLocalPhoneProvider() {
  let env;
  try {
    env = parseEnv(await readFile(".env.local", "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (env.BARI_PHONE_AUTH_MODE !== "mock") return false;
  assert.match(
    env.VITE_SUPABASE_URL ?? "",
    /^http:\/\/(127\.0\.0\.1|localhost):55431\/?$/,
  );
  const context = JSON.parse(
    execFileSync("docker", ["context", "inspect"], { encoding: "utf8" }),
  )[0];
  const endpoint = context.Endpoints.docker.Host;
  assert.ok(
    endpoint.startsWith("unix://"),
    "Local phone setup requires a Unix Docker socket.",
  );
  const socketPath = endpoint.slice(7),
    name = "supabase_auth_bari-khata";
  const docker = (method, path, value) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath,
          path,
          method,
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () => {
            if ((res.statusCode ?? 500) >= 400) {
              reject(
                new Error(`Local Docker operation failed (${res.statusCode}).`),
              );
              return;
            }
            resolve(text ? JSON.parse(text) : null);
          });
        },
      );
      req.on("error", reject);
      req.end(value === undefined ? undefined : JSON.stringify(value));
    });
  const original = await docker("GET", `/containers/${name}/json`);
  assert.equal(
    original.Config.Labels["com.supabase.cli.project"],
    "bari-khata",
  );
  assert.equal(
    original.Mounts.length,
    0,
    "Refusing to change an auth container with storage mounts.",
  );
  const aliasKeys =
    /^GOTRUE_EXTERNAL_PHONE_(?:CLIENT_ID|SECRET|URL|REDIRECT_URI|SKIP_NONCE_CHECK|EMAIL_OPTIONAL)=/;
  const currentEnv = original.Config.Env;
  if (
    currentEnv.includes("GOTRUE_EXTERNAL_PHONE_ENABLED=true") &&
    !currentEnv.some((value) => aliasKeys.test(value))
  )
    return false;
  const config = {
    ...original.Config,
    Env: [
      ...currentEnv.filter(
        (value) =>
          !value.startsWith("GOTRUE_EXTERNAL_PHONE_ENABLED=") &&
          !aliasKeys.test(value),
      ),
      "GOTRUE_EXTERNAL_PHONE_ENABLED=true",
    ],
    HostConfig: original.HostConfig,
  };
  delete config.ImageManifestDescriptor;
  const networks = Object.fromEntries(
    Object.entries(original.NetworkSettings.Networks).map(
      ([network, value]) => [
        network,
        {
          Aliases: (value.Aliases ?? []).filter(
            (alias) =>
              alias !== original.Id && alias !== original.Id.slice(0, 12),
          ),
        },
      ],
    ),
  );
  const backup = `${name}-phone-backup-${randomUUID().slice(0, 8)}`;
  await mkdir("private", { recursive: true, mode: 0o700 });
  await writeFile(
    "private/phone-auth-container-recovery.json",
    JSON.stringify(original),
    { mode: 0o600 },
  );
  await chmod("private/phone-auth-container-recovery.json", 0o600);
  let renamed = false,
    created = false;
  try {
    await docker("POST", `/containers/${name}/stop?t=10`);
    await docker("POST", `/containers/${name}/rename?name=${backup}`);
    renamed = true;
    for (const network of Object.keys(networks))
      await docker("POST", `/networks/${network}/disconnect`, {
        Container: backup,
        Force: true,
      });
    await docker("POST", `/containers/create?name=${name}`, {
      ...config,
      NetworkingConfig: { EndpointsConfig: networks },
    });
    created = true;
    await docker("POST", `/containers/${name}/start`);
    let healthy = false;
    for (let attempt = 0; attempt < 160; attempt++) {
      const state = await docker("GET", `/containers/${name}/json`);
      if (
        state.State.Running &&
        (state.State.Health?.Status === "healthy" || !state.State.Health)
      ) {
        healthy = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(healthy, "Local phone auth container did not become healthy.");
    await docker("DELETE", `/containers/${backup}`);
    await unlink("private/phone-auth-container-recovery.json");
    return true;
  } catch (error) {
    if (created)
      await docker("DELETE", `/containers/${name}?force=true`).catch(() => {});
    if (renamed) {
      await docker("POST", `/containers/${backup}/rename?name=${name}`);
      const restored = await docker("GET", `/containers/${name}/json`);
      for (const [network, EndpointConfig] of Object.entries(networks)) {
        if (!restored.NetworkSettings.Networks[network])
          await docker("POST", `/networks/${network}/connect`, {
            Container: name,
            EndpointConfig,
          });
      }
      await docker("POST", `/containers/${name}/start`);
    }
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const changed = await enableLocalPhoneProvider();
  console.log(
    changed
      ? "Local native phone login enabled without an SMS sender; database volumes were not changed."
      : "Local phone provider already configured or mock mode is off.",
  );
}

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { accountPlugin } from "./server/accountPlugin.ts";
import { sharedReceiptPlugin } from "./server/sharedReceiptPlugin.ts";
import { mcpPlugin } from "./server/mcpPlugin.js";
import { phoneOtpPlugin } from "./server/phoneOtpPlugin.ts";
import { phoneAuthMode } from "./server/phoneOtp.ts";
import { serviceWorkerSource } from "./scripts/serviceWorker.ts";
import { checkPwaBuild } from "./scripts/checkPwaBuild.ts";
import releasePolicy from "./release-policy.json" with { type: "json" };

const { version: appVersion } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

function privateFiles(): Plugin {
  return {
    name: "bari-khata-private-files",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        let pathname: string;
        try {
          pathname = decodeURIComponent(
            new URL(request.url ?? "/", "http://localhost").pathname,
          ).replaceAll("\\", "/");
        } catch {
          response.statusCode = 400;
          response.end();
          return;
        }
        const rootPrivate =
          /^\/private(?:\/|$)/i.test(pathname) &&
          !/^\/private\/tmp(?:\/|$)/i.test(pathname);
        const projectPrivate =
          /(?:^|\/)bari-khata(?:-v\d+)?\/private(?:\/|$)/i.test(pathname);
        if (rootPrivate || projectPrivate) {
          response.statusCode = 403;
          response.setHeader("Cache-Control", "no-store");
          response.end("Forbidden");
          return;
        }
        next();
      });
    },
  };
}

function offlineShell(): Plugin {
  return {
    name: "bari-khata-offline-shell",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        const assets = [
          "/",
          "/index.html",
          "/manifest.webmanifest",
          "/icon.svg",
          "/icon-192.png",
          "/icon-512.png",
          "/apple-touch-icon.png",
          "/brands/bkash.svg",
          ...Object.keys(bundle)
            .filter((name) => name !== "index.html")
            .filter((name) => name !== "release.json")
            .map((name) => `/${name}`),
        ];
        const html = bundle["index.html"];
        if (html?.type !== "asset")
          this.error("The offline shell requires Vite's emitted index.html.");
        const hash = createHash("sha256").update(JSON.stringify(assets));
        hash.update(String(html.source));
        hash.update(serviceWorkerSource.toString());
        for (const file of [
          "manifest.webmanifest",
          "icon.svg",
          "icon-192.png",
          "icon-512.png",
          "apple-touch-icon.png",
          "brands/bkash.svg",
        ])
          hash.update(readFileSync(`public/${file}`));
        const version = hash.digest("hex").slice(0, 16);
        html.source = String(html.source).replace(
          "</head>",
          `<meta name="bari-build" content="${version}" /></head>`,
        );
        const source = serviceWorkerSource(version, assets);
        this.emitFile({ type: "asset", fileName: "sw.js", source });
      },
    },
    writeBundle(options) {
      const read = (file: string) =>
        readFileSync(resolve(options.dir ?? "dist", file), "utf8");
      checkPwaBuild(
        read("index.html"),
        read("sw.js"),
        JSON.parse(read("release.json")),
        { latestVersion: appVersion, ...releasePolicy },
      );
    },
  };
}

function releaseManifest(): Plugin {
  const source = JSON.stringify({
    latestVersion: appVersion,
    ...releasePolicy,
  });
  return {
    name: "bari-khata-release-manifest",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (
          new URL(request.url ?? "/", "http://localhost").pathname !==
          "/release.json"
        )
          return next();
        response.setHeader("Content-Type", "application/json");
        response.setHeader("Cache-Control", "no-store");
        response.end(source);
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "release.json", source });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const phoneMode = phoneAuthMode(env);
  return {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
      "import.meta.env.VITE_PHONE_AUTH_MODE": JSON.stringify(phoneMode),
      "import.meta.env.VITE_ENABLE_PHONE_OTP": JSON.stringify(
        String(phoneMode !== "off"),
      ),
    },
    plugins: [
      privateFiles(),
      phoneOtpPlugin(env),
      accountPlugin(env),
      sharedReceiptPlugin(env),
      mcpPlugin(env),
      react(),
      releaseManifest(),
      offlineShell(),
    ],
    server: {
      port: 5180,
      strictPort: true,
      fs: {
        deny: [
          "**/.env",
          "**/.env.*",
          "**/.git/**",
          "**/private/migration/**",
          "**/private/LOCAL_ACCESS*",
          "**/private/accounts/**",
          "**/bari-khata*/private/**",
        ],
      },
    },
    preview: { port: 4180, strictPort: true },
  };
});

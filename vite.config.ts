import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { accountPlugin } from "./server/accountPlugin.ts";
import { phoneOtpPlugin } from "./server/phoneOtpPlugin.ts";
import { phoneAuthMode } from "./server/phoneOtp.ts";

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
    generateBundle(_, bundle) {
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
          .map((name) => `/${name}`),
      ];
      const hash = createHash("sha256").update(JSON.stringify(assets));
      hash.update(readFileSync("index.html"));
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
      const source = `
const CACHE = 'bari-khata-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('bari-khata-') && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')).then(cached => cached || fetch(request)));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(cached => cached || fetch(request)));
  }
});`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const phoneMode = phoneAuthMode(env);
  return {
    define: {
      "import.meta.env.VITE_PHONE_AUTH_MODE": JSON.stringify(phoneMode),
      "import.meta.env.VITE_ENABLE_PHONE_OTP": JSON.stringify(
        String(phoneMode !== "off"),
      ),
    },
    plugins: [
      privateFiles(),
      phoneOtpPlugin(env),
      accountPlugin(env),
      react(),
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

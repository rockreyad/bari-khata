import type { Plugin } from "vite";
import { createPhoneOtpMiddleware, phoneGatewayConfig } from "./phoneOtp.ts";

export function phoneOtpPlugin(
  env: Record<string, string | undefined>,
): Plugin {
  const config = phoneGatewayConfig(env);
  return {
    name: "bari-local-phone-otp",
    configureServer(server) {
      server.middlewares.use(createPhoneOtpMiddleware(config));
    },
    configurePreviewServer(server) {
      server.middlewares.use(createPhoneOtpMiddleware(config));
    },
  };
}

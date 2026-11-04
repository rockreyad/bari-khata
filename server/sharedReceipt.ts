import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  accountDeleteConfigured,
  type AccountDeleteConfig,
} from "./accountDelete.js";

export const SHARED_RECEIPT_LIMIT = 10 * 1024 * 1024;
export type SharedReceiptConfig = AccountDeleteConfig;
const Mime = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const Id = z.string().min(1).max(160);
const Input = z.strictObject({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  entryId: Id,
  receiptId: Id,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
type Input = z.infer<typeof Input>;
const Authorization = z.strictObject({
  storagePath: z.string().min(1).max(400),
  id: Id,
  name: z.string().min(1).max(300),
  mime: Mime,
  size: z.number().int().positive(),
});
export type SharedReceiptBackend = {
  authorize: (input: Input, signal: AbortSignal) => Promise<unknown>;
  download: (path: string, signal: AbortSignal) => Promise<Response>;
};
export function sharedReceiptConfig(
  env: Record<string, string | undefined>,
): SharedReceiptConfig {
  return {
    url: env.VITE_SUPABASE_URL ?? "",
    serviceKey: env.BARI_SUPABASE_SERVICE_ROLE_KEY ?? "",
    origin:
      env.BARI_PUBLIC_APP_ORIGIN ||
      (env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
        : env.VERCEL_URL
          ? `https://${env.VERCEL_URL}`
          : ""),
    vercel: env.VERCEL === "1",
  };
}
class Failure extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
};
function failure(status: number, error: string) {
  return Response.json({ error }, { status, headers });
}
async function bytes(response: Response | Request, maximum: number) {
  if (Number(response.headers.get("content-length") ?? 0) > maximum)
    throw new Failure(413, "share_receipt_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Failure(400, "share_invalid_request");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Failure(413, "share_receipt_too_large");
      }
      chunks.push(part.value);
    }
    return new Uint8Array(Buffer.concat(chunks, size));
  } finally {
    reader.releaseLock();
  }
}
function backend(config: SharedReceiptConfig): SharedReceiptBackend {
  const client = createClient(config.url, config.serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return {
    async authorize(input, signal) {
      const result = await client
        .rpc("contact_share_receipt_authorization", {
          p_token: input.token,
          p_entry_id: input.entryId,
          p_receipt_id: input.receiptId,
          p_revision: input.revision,
        })
        .abortSignal(signal);
      if (result.error)
        throw new Error(
          result.error.message.includes("share_changed")
            ? "share_changed"
            : "share_receipt_failed",
        );
      return result.data;
    },
    download(path, signal) {
      return fetch(
        new URL(
          `/storage/v1/object/authenticated/bari-receipts/${path.split("/").map(encodeURIComponent).join("/")}`,
          config.url,
        ),
        {
          signal,
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          headers: {
            apikey: config.serviceKey,
            Authorization: `Bearer ${config.serviceKey}`,
          },
        },
      );
    },
  };
}
function signature(data: Uint8Array, mime: z.infer<typeof Mime>) {
  if (mime === "application/pdf")
    return Buffer.from(data.subarray(0, 5)).toString("ascii") === "%PDF-";
  if (mime === "image/jpeg")
    return data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (mime === "image/png")
    return Buffer.from(data.subarray(0, 8)).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  return (
    data.length >= 12 &&
    Buffer.from(data.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(data.subarray(8, 12)).toString("ascii") === "WEBP"
  );
}
export function createSharedReceiptHandler(
  config: SharedReceiptConfig,
  dependency?: SharedReceiptBackend,
) {
  let client = dependency;
  return async (request: Request) => {
    try {
      if (!accountDeleteConfigured(config))
        throw new Failure(503, "share_unavailable");
      if (request.method !== "POST")
        throw new Failure(405, "share_invalid_request");
      if (
        request.headers.get("origin") !== config.origin ||
        new URL(request.url).origin !== config.origin ||
        (request.headers.has("sec-fetch-site") &&
          request.headers.get("sec-fetch-site") !== "same-origin") ||
        new URL(request.url).search
      )
        throw new Failure(403, "share_invalid_request");
      if (
        !/^application\/json(?:\s*;|$)/i.test(
          request.headers.get("content-type") ?? "",
        )
      )
        throw new Failure(415, "share_invalid_request");
      request.signal.throwIfAborted();
      let input: Input;
      try {
        input = Input.parse(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              await bytes(request, 1024),
            ),
          ),
        );
      } catch (error) {
        if (error instanceof Failure) throw error;
        throw new Failure(400, "share_invalid_request");
      }
      client ??= backend(config);
      const readAuthorization = async () => {
        request.signal.throwIfAborted();
        const raw = await client!.authorize(input, request.signal);
        if (raw === null) throw new Failure(404, "share_unavailable");
        const metadata = Authorization.parse(raw);
        const parts = metadata.storagePath.split("/");
        if (
          metadata.id !== input.receiptId ||
          parts.length !== 2 ||
          !z.uuid().safeParse(parts[0]).success ||
          parts[1] !== input.receiptId ||
          !/^[^/\\\u0000-\u001f]+$/.test(parts[1]) ||
          [".", ".."].includes(parts[1])
        )
          throw new Failure(502, "share_receipt_failed");
        if (metadata.size > SHARED_RECEIPT_LIMIT)
          throw new Failure(413, "share_receipt_too_large");
        return metadata;
      };
      const metadata = await readAuthorization();
      const response = await client.download(
        metadata.storagePath,
        request.signal,
      );
      if (
        !response.ok ||
        response.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== metadata.mime
      ) {
        await response.body?.cancel();
        throw new Failure(502, "share_receipt_failed");
      }
      const data = await bytes(response, SHARED_RECEIPT_LIMIT);
      request.signal.throwIfAborted();
      if (data.byteLength !== metadata.size || !signature(data, metadata.mime))
        throw new Failure(502, "share_receipt_failed");
      if (
        JSON.stringify(await readAuthorization()) !== JSON.stringify(metadata)
      )
        throw new Failure(409, "share_changed");
      request.signal.throwIfAborted();
      return new Response(data, {
        headers: {
          ...headers,
          "Content-Type": metadata.mime,
          "Content-Length": String(data.byteLength),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(metadata.name)}`,
        },
      });
    } catch (error) {
      if (request.signal.aborted) return failure(499, "share_receipt_failed");
      if (error instanceof Failure) return failure(error.status, error.code);
      if (error instanceof Error && error.message === "share_changed")
        return failure(409, "share_changed");
      return failure(502, "share_receipt_failed");
    }
  };
}

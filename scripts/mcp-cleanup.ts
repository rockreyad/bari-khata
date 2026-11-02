import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "vite";
import { z } from "zod";

const Uploads = z.object({
  uploads: z
    .array(
      z.object({
        ownerId: z.uuid(),
        id: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
      }),
    )
    .max(100),
});
export async function cleanupMcpUploads(client: SupabaseClient) {
  const listed = await client.rpc("mcp_upload_cleanup", {
    p_action: "list",
    p_data: { limit: 100 },
  });
  if (listed.error) throw new Error("পরিষ্কারের তালিকা পাওয়া যায়নি।");
  const { uploads } = Uploads.parse(listed.data);
  let deleted = 0,
    failed = 0;
  const staging = client.storage.from("bari-mcp-staging");
  for (const upload of uploads) {
    try {
      const prefix = `${upload.ownerId}/.mcp-chunks/${upload.id}`;
      const listedChunks = await staging.list(prefix, {
        limit: 41,
        sortBy: { column: "name", order: "asc" },
      });
      if (listedChunks.error) throw new Error("chunks_unavailable");
      const chunks = listedChunks.data ?? [];
      if (
        chunks.length > 40 ||
        chunks.some(
          (chunk) => !/^0(?:[0-2][0-9]|3[0-9])$/.test(chunk.name) || !chunk.id,
        )
      )
        throw new Error("unexpected_chunk_path");
      const paths = [
        `${upload.ownerId}/.mcp-staging/${upload.id}`,
        ...chunks.map((chunk) => `${prefix}/${chunk.name}`),
      ];
      const staged = await staging.remove(paths);
      if (staged.error) throw new Error("staging_cleanup_failed");
      const active = await client.storage
        .from("bari-receipts")
        .remove([`${upload.ownerId}/${upload.id}`]);
      if (active.error) throw new Error("active_cleanup_failed");
      const ack = await client.rpc("mcp_upload_cleanup", {
        p_action: "ack",
        p_data: { ownerId: upload.ownerId, id: upload.id },
      });
      if (
        ack.error ||
        !z.object({ deleted: z.literal(true) }).safeParse(ack.data).success
      )
        throw new Error("cleanup_not_acknowledged");
      deleted++;
    } catch {
      failed++;
    }
  }
  return { listed: uploads.length, deleted, failed };
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== "--local")
    throw new Error(
      "এই কমান্ড শুধু --local দিয়ে স্থানীয় খাতার জন্য চালানো যায়।",
    );
  const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
  let url = env.VITE_SUPABASE_URL ?? "",
    key =
      env.BARI_SUPABASE_SERVICE_ROLE_KEY ??
      env.BARI_DEV_SUPABASE_SERVICE_ROLE_KEY ??
      "";
  if (url && !/^http:\/\/(?:127\.0\.0\.1|localhost):55431\/?$/.test(url))
    throw new Error("এই কমান্ড শুধু স্থানীয় ৫৫৪৩১ পোর্টের Supabase-এ চলে।");
  if (!url || !key) {
    const status = JSON.parse(
      execFileSync(
        resolve("node_modules/.bin/supabase"),
        ["status", "-o", "json"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    url ||= String(status.API_URL ?? "");
    key ||= String(status.SERVICE_ROLE_KEY ?? "");
  }
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost):55431\/?$/.test(url) || !key)
    throw new Error("স্থানীয় Supabase আগে চালু করুন।");
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const result = await cleanupMcpUploads(client);
  console.log(
    `অব্যবহৃত আপলোড: ${result.listed}টি পাওয়া গেছে, ${result.deleted}টি পরিষ্কার হয়েছে, ${result.failed}টি পরে আবার চেষ্টা করতে হবে।`,
  );
  if (result.failed) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "পরিষ্কার করা শেষ হয়নি। স্থানীয় সংযোগ ও অনুমতি যাচাই করে আবার চালান।",
    );
    process.exitCode = 1;
  });
}

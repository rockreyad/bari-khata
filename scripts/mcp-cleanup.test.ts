import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanupMcpUploads } from "./mcp-cleanup";

const ownerId = "67f0b2f0-7869-4c97-af84-58b926c6d8dc";
function setup(
  options: {
    removalError?: boolean;
    badChunk?: boolean;
    badOwner?: boolean;
  } = {},
) {
  const events: string[] = [];
  const rpc = vi.fn(async (_name: string, args: { p_action: string }) => {
    events.push(args.p_action);
    return args.p_action === "list"
      ? {
          error: null,
          data: {
            uploads: [
              {
                ownerId: options.badOwner ? "../other" : ownerId,
                id: "expired-upload",
              },
            ],
          },
        }
      : { error: null, data: { deleted: true } };
  });
  const remove = vi.fn(async (paths: string[]) => {
    events.push(`remove:${paths[0]}`);
    return { error: options.removalError ? { message: "failed" } : null };
  });
  const list = vi.fn(async () => ({
    error: null,
    data: [{ id: "storage-id", name: options.badChunk ? "../other" : "000" }],
  }));
  const client = {
    rpc,
    storage: { from: vi.fn(() => ({ list, remove })) },
  } as unknown as SupabaseClient;
  return { client, rpc, remove, events };
}

describe("অসমাপ্ত ভাউচার পরিষ্কার", () => {
  it("সব নির্দিষ্ট ফাইল সরানোর পরেই metadata বাদ দেয়", async () => {
    const context = setup();
    await expect(cleanupMcpUploads(context.client)).resolves.toEqual({
      listed: 1,
      deleted: 1,
      failed: 0,
    });
    expect(context.events).toEqual([
      "list",
      `remove:${ownerId}/.mcp-staging/expired-upload`,
      `remove:${ownerId}/expired-upload`,
      "ack",
    ]);
    expect(context.remove.mock.calls[0][0]).toEqual([
      `${ownerId}/.mcp-staging/expired-upload`,
      `${ownerId}/.mcp-chunks/expired-upload/000`,
    ]);
  });
  it("ফাইল সরানো ব্যর্থ হলে metadata রেখে দেয়", async () => {
    const context = setup({ removalError: true });
    await expect(cleanupMcpUploads(context.client)).resolves.toEqual({
      listed: 1,
      deleted: 0,
      failed: 1,
    });
    expect(context.rpc.mock.calls.map(([, args]) => args.p_action)).toEqual([
      "list",
    ]);
  });
  it("অপ্রত্যাশিত chunk path পেলে কোনো ফাইল সরায় না", async () => {
    const context = setup({ badChunk: true });
    await expect(cleanupMcpUploads(context.client)).resolves.toEqual({
      listed: 1,
      deleted: 0,
      failed: 1,
    });
    expect(context.remove).not.toHaveBeenCalled();
  });
  it("অযাচাই করা মালিকের path গ্রহণ করে না", async () => {
    const context = setup({ badOwner: true });
    await expect(cleanupMcpUploads(context.client)).rejects.toThrow();
    expect(context.remove).not.toHaveBeenCalled();
  });
});

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { assertAccountCanBeDeleted, deleteOwnAccount } from "./deleteAccount";
import { getAccountDatabase, setActiveOwner } from "../../data/database";
import { createEmptyLedger } from "../../domain/demo";
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const session = {
  user: { id: owner },
  access_token: "safe-session-token",
} as Session;
const fetcher = vi.fn(),
  ready = vi.fn();
let active: string | null = owner;
const options = () => ({
  fetcher,
  readOwner: () => active,
  session: async () => session,
  ready,
});
beforeEach(() => {
  vi.clearAllMocks();
  active = owner;
  ready.mockResolvedValue(undefined);
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ deleted: true }), { status: 200 }),
  );
});
afterEach(async () => {
  setActiveOwner(null);
  await getAccountDatabase(owner).delete();
});
describe("delete own account client", () => {
  it("sends only typed confirmation and the current verified session; keeps financial storage untouched", async () => {
    await deleteOwnAccount(owner, "DELETE", options());
    expect(ready).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/account-delete",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer safe-session-token",
        },
        body: '{"confirmation":"DELETE"}',
      }),
    );
  });
  it("does not issue a deletion after the active account changes while loading a session", async () => {
    await expect(
      deleteOwnAccount(owner, "DELETE", {
        ...options(),
        session: async () => {
          active = other;
          return session;
        },
      }),
    ).rejects.toThrow("account_changed");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not issue a deletion if another account session was returned", async () => {
    await expect(
      deleteOwnAccount(owner, "DELETE", {
        ...options(),
        session: async () => ({
          ...session,
          user: { ...session.user, id: other },
        }),
      }),
    ).rejects.toThrow("sign_in_required");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rechecks pending data just before the request", async () => {
    ready
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("account_has_pending_data"));
    await expect(deleteOwnAccount(owner, "DELETE", options())).rejects.toThrow(
      "account_has_pending_data",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("does not report success to a new account after an in-flight request", async () => {
    fetcher.mockImplementation(async () => {
      active = other;
      return new Response('{"deleted":true}');
    });
    await expect(deleteOwnAccount(owner, "DELETE", options())).rejects.toThrow(
      "account_changed",
    );
  });
  it.each(["delete", " DELETE", "DELETE ", ""])(
    'requires exact DELETE, received "%s"',
    async (confirmation) => {
      await expect(
        deleteOwnAccount(owner, confirmation, options()),
      ).rejects.toThrow("confirmation_required");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("returns controlled server errors and rejects a malformed success", async () => {
    fetcher
      .mockResolvedValueOnce(
        new Response('{"error":"account_delete_unavailable"}', { status: 404 }),
      )
      .mockResolvedValueOnce(new Response('{"deleted":"true"}'));
    await expect(deleteOwnAccount(owner, "DELETE", options())).rejects.toThrow(
      "account_delete_unavailable",
    );
    await expect(deleteOwnAccount(owner, "DELETE", options())).rejects.toThrow(
      "account_delete_failed",
    );
  });
});

it("blocks pending IndexedDB data and conflicts without clearing local records, drafts or outbox", async () => {
  setActiveOwner(owner);
  const db = getAccountDatabase(owner);
  await db.open();
  const ledger = createEmptyLedger();
  const row = {
    id: "real" as const,
    ledger,
    generation: 1,
    ownerId: owner,
    cloudRevision: 1,
    pending: false,
    lastSyncedAt: null,
    updatedAt: "2026-11-02T00:00:00Z",
  };
  await db.workspaces.put(row);
  await db.drafts.put({
    id: "real:unfinished",
    workspace: "real",
    value: { note: "unfinished" },
    updatedAt: row.updatedAt,
  });
  await assertAccountCanBeDeleted(owner);
  await db.workspaces.put({ ...row, pending: true });
  await expect(assertAccountCanBeDeleted(owner)).rejects.toThrow(
    "account_has_pending_data",
  );
  await db.workspaces.put(row);
  await db.outbox.put({
    id: "request",
    workspace: "real",
    ownerId: owner,
    generation: 1,
    baseRevision: 1,
    ledger,
    createdAt: row.updatedAt,
  });
  await expect(assertAccountCanBeDeleted(owner)).rejects.toThrow(
    "account_has_pending_data",
  );
  await db.outbox.clear();
  await db.conflicts.put({
    id: "real",
    ownerId: owner,
    revision: 2,
    ledger,
    updatedAt: row.updatedAt,
  });
  await expect(assertAccountCanBeDeleted(owner)).rejects.toThrow(
    "account_has_pending_data",
  );
  expect(await db.workspaces.get("real")).toEqual(row);
  expect(await db.drafts.count()).toBe(1);
  expect(await db.conflicts.count()).toBe(1);
});

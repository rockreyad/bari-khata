import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { legacyArchitectureFixture } from "../domain/testing/legacyArchitecture";
import { createEmptyLedger } from "../domain/demo";
import { getAccountDatabase, setActiveOwner } from "./database";
import { LedgerRepository } from "./repository";
import type { Ledger } from "../domain/model";

const client = vi.hoisted(() => ({ value: {} as unknown }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => client.value }));
const owner = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  setActiveOwner(null);
  await getAccountDatabase(owner).delete();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("migrates explicitly chosen legacy cloud data, recovers discarded local edits and syncs against the chosen revision", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.invalid");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "synthetic-public-key");
  vi.stubGlobal("navigator", { onLine: true });
  setActiveOwner(owner);
  const database = getAccountDatabase(owner);
  const repository = new LedgerRepository(database);
  await repository.ensure("real", createEmptyLedger());
  await repository.save((ledger) => ({
    ...ledger,
    project: { ...ledger.project, name: "নমুনা স্থানীয় নাম" },
  }));
  const local = (await repository.read())!;
  const original = legacyArchitectureFixture();
  await database.conflicts.put({
    id: "real",
    ledger: original,
    revision: 11,
    ownerId: owner,
    updatedAt: "2026-11-05T00:00:00.000Z",
  });
  let document: Ledger = original;
  let revision = 11;
  const writes: { expectedRevision: number; document: Ledger }[] = [];
  client.value = {
    auth: {
      getSession: async () => ({
        data: {
          session: { user: { id: owner }, access_token: "synthetic-token" },
        },
        error: null,
      }),
    },
    rpc: async (
      name: string,
      args?: { p_expected_revision: number; p_document: Ledger },
    ) => {
      if (name === "load_ledger_snapshot")
        return {
          data: { revision, document, updatedAt: "2026-11-05T00:00:00.000Z" },
          error: null,
        };
      expect(name).toBe("save_ledger_snapshot");
      writes.push({
        expectedRevision: args!.p_expected_revision,
        document: args!.p_document,
      });
      document = args!.p_document;
      revision++;
      return {
        data: {
          status: "saved",
          revision,
          updatedAt: "2026-11-05T00:01:00.000Z",
        },
        error: null,
      };
    },
  };
  const { resolveCloudConflict } = await import("./sync");
  expect((await resolveCloudConflict("use-cloud")).status).toBe("synced");
  expect(writes).toHaveLength(1);
  expect(writes[0].expectedRevision).toBe(11);
  expect(writes[0].document.architectureVersion).toBe(2);
  expect(writes[0].document.entries).toEqual(original.entries);
  const saved = (await repository.read())!;
  expect(saved).toMatchObject({
    cloudRevision: 12,
    pending: false,
    generation: local.generation + 1,
  });
  const recovery = (await database.recoveries.toArray())[0];
  expect(recovery.ledger).toEqual(local.ledger);
  const migration = (await database.migrations.toArray())[0];
  expect(migration.before.ledger).toEqual(original);
  expect(migration.before.cloudRevision).toBe(11);
  expect(migration.report.before).toEqual(migration.report.after);
  expect(await database.conflicts.count()).toBe(0);
});

import { describe, expect, it } from "vitest";
import { LedgerSchema, WorkSchema } from "./model";
import { saveWorkChange, workChanges } from "./workActivity";

describe("work activity", () => {
  it("defaults legacy works without inventing a start date or old activity", () => {
    const work = WorkSchema.parse({ id: "tiles", name: "টাইলস" });
    expect(work).toMatchObject({
      startedOn: null,
      completedOn: null,
      activity: [],
      quickActions: null,
    });
  });
  it("keeps every work change and its before/after fields", () => {
    const original = LedgerSchema.parse({
      works: [{ id: "tiles", name: "টাইলস", status: "planned" }],
    });
    const started = saveWorkChange(
      original,
      WorkSchema.parse({
        ...original.works[0],
        status: "ongoing",
        startedOn: "2026-11-01",
      }),
      "2026-11-01T10:00:00.000Z",
    );
    const ended = saveWorkChange(
      started,
      WorkSchema.parse({
        ...started.works[0],
        name: "টাইলসের কাজ",
        status: "done",
        completedOn: "2026-11-03",
      }),
      "2026-11-03T10:00:00.000Z",
    );
    expect(ended.works[0].activity).toHaveLength(2);
    expect(ended.works[0].activity[0].before?.status).toBe("planned");
    expect(ended.works[0].activity[0].after.startedOn).toBe("2026-11-01");
    expect(
      workChanges(
        ended.works[0].activity[1].before,
        ended.works[0].activity[1].after,
      ),
    ).toEqual(["name", "status", "completedOn"]);
    expect(original.works[0].activity).toEqual([]);
  });
  it("records creation once and ignores an unchanged cloned preset array", () => {
    const original = LedgerSchema.parse({});
    const created = saveWorkChange(
      original,
      WorkSchema.parse({
        id: "tiles",
        name: "টাইলস",
        quickActions: ["expense", "payment"],
      }),
    );
    expect(created.works[0].activity[0].before).toBeNull();
    expect(saveWorkChange(created, structuredClone(created.works[0]))).toBe(
      created,
    );
  });
  it("rejects impossible and reversed dates without overwriting the current work", () => {
    const ledger = LedgerSchema.parse({
      works: [{ id: "tiles", name: "টাইলস" }],
    });
    for (const dates of [
      { startedOn: "2026-02-30" },
      { startedOn: "2026-11-10", completedOn: "2026-11-01" },
    ]) {
      expect(() =>
        saveWorkChange(
          ledger,
          WorkSchema.parse({ ...ledger.works[0], ...dates }),
        ),
      ).toThrow();
    }
    expect(ledger.works[0].activity).toHaveLength(0);
  });
  it("validates every activity snapshot and retains meaningful preset changes", () => {
    const work = WorkSchema.parse({
      id: "w",
      name: "কাজ",
      quickActions: ["expense"],
    });
    const first = saveWorkChange(LedgerSchema.parse({ works: [work] }), {
      ...work,
      quickActions: ["payment"],
    });
    expect(
      workChanges(
        first.works[0].activity[0].before,
        first.works[0].activity[0].after,
      ),
    ).toEqual(["quickActions"]);
    const broken = structuredClone(first.works[0]);
    broken.activity[0].after.startedOn = "2026-02-30";
    expect(() => WorkSchema.parse(broken)).toThrow();
  });
});

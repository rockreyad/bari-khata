import { describe, expect, it } from "vitest";
import {
  ContractSchema,
  EntrySchema,
  type Contract,
  type Entry,
} from "../../domain/model";
import { recentJobs } from "./jobView";

const job = (id: string, input: Partial<Contract> = {}) =>
  ContractSchema.parse({
    id,
    personId: "worker",
    workId: "roof",
    title: id,
    total: 100000,
    status: "ongoing",
    ...input,
  });
const payment = (contractId: string, input: Partial<Entry> = {}) =>
  EntrySchema.parse({
    id: `paid-${contractId}`,
    kind: "payment",
    personId: "worker",
    contractId,
    account: "labour",
    date: "2026-11-01",
    paymentParts: [{ amount: 1000 }],
    ...input,
  });
const ids = (jobs: Contract[], entries: Entry[]) =>
  recentJobs(jobs, entries).map((value) => value.id);

describe("job priority", () => {
  it("keeps ongoing jobs first and finished jobs last even when a finished job has the newest payment", () => {
    const jobs = [
      job("finished", { status: "done" }),
      job("planned", { status: "planned" }),
      job("unknown", { status: null }),
      job("ongoing"),
    ];
    expect(ids(jobs, [payment("finished", { date: "2026-11-04" })])).toEqual([
      "ongoing",
      "planned",
      "unknown",
      "finished",
    ]);
  });

  it("uses the latest transaction date rather than a later contract edit or a newly entered backdated payment", () => {
    const jobs = [
      job("edited", {
        history: [{ at: "2026-11-05T00:00:00Z", total: 100000, note: "" }],
      }),
      job("recent-payment"),
      job("no-payment", { agreedOn: "2026-11-06" }),
    ];
    const entries = [
      payment("edited", {
        date: "2026-10-01",
        createdAt: "2026-11-05T00:00:00Z",
        updatedAt: "2026-11-06T00:00:00Z",
      }),
      payment("recent-payment", { date: "2026-11-02" }),
      payment("recent-payment", { id: "older-payment", date: "2026-09-01" }),
    ];
    const before = JSON.stringify({ jobs, entries });
    expect(ids(jobs, entries)).toEqual([
      "recent-payment",
      "edited",
      "no-payment",
    ]);
    expect(JSON.stringify({ jobs, entries })).toBe(before);
  });

  it("ignores voided payments, another person's links and unassigned payments to the same person and notebook", () => {
    const jobs = [job("inactive"), job("valid")];
    expect(
      ids(jobs, [
        payment("valid", { date: "2026-10-01" }),
        payment("inactive", { date: "2026-11-04", voided: true }),
        payment("inactive", {
          id: "wrong-person",
          date: "2026-11-05",
          personId: "another-worker",
        }),
        payment("inactive", {
          id: "unassigned",
          date: "2026-11-06",
          contractId: null,
          allocations: [{ workId: "roof", amount: 1000 }],
        }),
      ]),
    ).toEqual(["valid", "inactive"]);
  });

  it("counts refunds and uses the recording time when a transaction has no date", () => {
    const jobs = [job("older"), job("refund")];
    expect(
      ids(jobs, [
        payment("older", { date: "2026-11-01" }),
        payment("refund", {
          kind: "refund",
          date: null,
          createdAt: "2026-11-03T10:00:00Z",
        }),
      ]),
    ).toEqual(["refund", "older"]);
  });

  it.each([
    ["2026-11-03T06:00:00Z", "2026-11-03T17:00:00Z", ["dated", "undated"]],
    ["2026-11-02T23:00:00Z", "2026-11-02T20:00:00Z", ["undated", "dated"]],
  ])(
    "compares dated and undated transactions on the same Dhaka calendar day before recording time (%s)",
    (undatedAt, datedAt, expected) => {
      const jobs = [job("undated"), job("dated")];
      const entries = [
        payment("undated", {
          date: null,
          createdAt: undatedAt,
        }),
        payment("dated", {
          date: "2026-11-03",
          createdAt: datedAt,
        }),
      ];
      expect(ids(jobs, entries)).toEqual(expected);
    },
  );

  it("keeps equal transaction dates stable when a contract is edited and orders new work consistently without transactions", () => {
    const jobs = [
      job("first"),
      job("edited", {
        history: [{ at: "2026-11-05T00:00:00Z", total: 100000, note: "" }],
      }),
      job("older-empty", { agreedOn: "2026-10-01" }),
      job("newer-empty", { agreedOn: "2026-11-01" }),
    ];
    expect(ids(jobs, [payment("first"), payment("edited")])).toEqual([
      "first",
      "edited",
      "newer-empty",
      "older-empty",
    ]);
  });
});

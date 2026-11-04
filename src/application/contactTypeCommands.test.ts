import { expect, it } from "vitest";
import { LedgerSchema } from "../domain/model";
import { contactPresetFor } from "../domain/contactTypes";
import { summarize } from "../domain/ledger";
import { applyMcpCommand, McpCommandSchema } from "./mcpCommands";

const context = {
  now: "2026-11-05T00:00:00.000Z",
  actor: { connectionId: "fixture-agent", name: "নমুনা সহকারী" },
};
it("supports explicit contact types through MCP and keeps them independent of free descriptions", () => {
  const initial = LedgerSchema.parse({});
  const created = applyMcpCommand(
    initial,
    {
      type: "create_person",
      name: "নমুনা ব্যক্তি",
      kind: "worker",
      contact_type: "professional",
      role: "নকশা",
    },
    context,
  ).ledger;
  const person = created.people[0];
  const updated = applyMcpCommand(
    created,
    {
      type: "update_person",
      person_id: person.id,
      reason: "পরিচয় বদলেছি",
      changes: { role: "সিমেন্ট ও রড" },
    },
    context,
  ).ledger;
  expect(updated.people[0].contactType).toBe("professional");
  expect(contactPresetFor(updated.people[0]).id).toBe("professional");
  expect(updated.entries).toEqual(created.entries);
  expect(summarize(updated)).toEqual(summarize(created));
  const shop = applyMcpCommand(
    updated,
    {
      type: "update_person",
      person_id: person.id,
      reason: "ধরন বদলেছি",
      changes: { kind: "shop" },
    },
    context,
  ).ledger;
  expect(shop.people[0]).toMatchObject({
    kind: "shop",
    contactType: "supplier",
  });
  expect(shop.entries).toEqual(created.entries);
  expect(
    McpCommandSchema.safeParse({
      type: "create_person",
      name: "নমুনা",
      kind: "shop",
      contact_type: "unknown",
    }).success,
  ).toBe(false);
  expect(() =>
    applyMcpCommand(
      initial,
      {
        type: "create_person",
        name: "নমুনা",
        kind: "shop",
        contact_type: "professional",
      },
      context,
    ),
  ).toThrow();
  expect(initial.people).toEqual([]);
});

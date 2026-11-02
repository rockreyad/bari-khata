import { describe, expect, it } from "vitest";
import { LedgerSchema, EntrySchema } from "../domain/model.js";
import { applyMcpCommand } from "./mcpCommands.js";
import { queryMcpLedger, queryToolDefinitions } from "./mcpQueries.js";

const context = {
  now: "2026-11-02T10:00:00.000Z",
  actor: { connectionId: "assistant-a", name: "সহকারী" },
};
function fixture() {
  const ledger = LedgerSchema.parse({
    people: [
      { id: "shop", name: "দোকান ১২", kind: "shop", phone: "01700000000" },
    ],
    works: [{ id: "roof", name: "ছাদ" }],
    materialGroups: [{ id: "cement", name: "সিমেন্ট", aliases: ["cement"] }],
    items: [
      {
        id: "item",
        name: "সিমেন্ট ১২",
        materialGroupId: "cement",
        aliases: ["cement twelve"],
        brand: "Brand",
      },
    ],
  });
  let next = applyMcpCommand(
    ledger,
    {
      type: "create_purchase",
      person_id: "shop",
      work_id: "roof",
      date: "2026-10-01",
      lines: [
        {
          label: "সিমেন্ট ১২",
          item_id: "item",
          cost_type: "material",
          amount_paisa: 600000,
        },
      ],
      payment_state: "unpaid",
    },
    context,
  ).ledger;
  next = applyMcpCommand(
    next,
    {
      type: "record_payment",
      person_id: "shop",
      work_id: "roof",
      account: "materials",
      date: "2026-11-02",
      amount_paisa: 200000,
      method: "cash",
    },
    context,
  ).ledger;
  return next;
}
describe("MCP ledger queries", () => {
  it("separates current balances from a period's cash flow and cost", () => {
    const result = queryMcpLedger(fixture(), "get_summary", {
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(result.period).toMatchObject({ cost_paisa: 0, paid_paisa: 200000 });
    expect(result.current).toMatchObject({
      cost_paisa: 600000,
      payable_paisa: 400000,
    });
    expect(result.balance_basis).toBe("current_snapshot");
  });
  it("finds Bengali and Latin digits, aliases, items, groups and payment purposes", () => {
    expect(
      queryMcpLedger(fixture(), "search_entities", { query: "দোকান 12" })
        .items as unknown[],
    ).toHaveLength(1);
    expect(
      queryMcpLedger(fixture(), "search_entities", {
        query: "cement twelve",
        entity_type: "item",
      }).items as unknown[],
    ).toHaveLength(1);
    expect(
      queryMcpLedger(fixture(), "list_entries", { query: "cement" })
        .items as unknown[],
    ).toHaveLength(1);
  });
  it("returns all page-friendly statement rows rather than silently truncating history", () => {
    const result = queryMcpLedger(fixture(), "get_person_statement", {
      person_id: "shop",
    });
    expect(result.total_count).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.current).toMatchObject({ payable_paisa: 400000 });
    expect(
      queryMcpLedger(fixture(), "export_statement", { person_id: "shop" }),
    ).toMatchObject({
      format: "structured_rows",
      complete_requires_all_pages: true,
      total_count: 2,
    });
    expect(
      queryToolDefinitions.every((tool) => tool.inputSchema.type === "object"),
    ).toBe(true);
  });
  it("shows source evidence and revisions, and includes voided events only on explicit request", () => {
    const ledger = fixture();
    const entry = ledger.entries[0];
    const next = applyMcpCommand(
      ledger,
      {
        type: "void_entry",
        entry_id: entry.id,
        expected_updated_at: entry.updatedAt,
        reason: "ভুল বিল",
      },
      context,
    ).ledger;
    expect(queryMcpLedger(next, "list_entries", {}).total_count).toBe(1);
    expect(
      queryMcpLedger(next, "list_entries", { include_voided: true })
        .total_count,
    ).toBe(2);
    const detail = queryMcpLedger(next, "get_entry", { entry_id: entry.id });
    expect(detail.revision_count).toBe(1);
    const history = queryMcpLedger(next, "get_change_history", {
      entry_id: entry.id,
    });
    expect(
      (history.items as { action: string }[]).map((event) => event.action),
    ).toContain("voided");
  });
  it("keeps historical and undated amounts visible without inventing settled balances", () => {
    const ledger = fixture();
    ledger.entries.push(
      EntrySchema.parse({
        id: "old",
        date: null,
        kind: "expense",
        balanceImpact: "historical",
        personId: "shop",
        account: "materials",
        lines: [
          {
            id: "old-line",
            workId: "roof",
            label: "পুরোনো বিল",
            costType: "material",
            amount: 100000,
          },
        ],
      }),
    );
    const result = queryMcpLedger(ledger, "get_summary", {
      from: "2026-11-01",
    });
    expect(result.unknown_date_count).toBe(1);
    expect(result.current).toMatchObject({
      cost_paisa: 700000,
      historical_cost_paisa: 100000,
      payable_paisa: 400000,
    });
  });
  it("rejects unknown identities and invalid query date ranges", () => {
    expect(() =>
      queryMcpLedger(fixture(), "get_entry", { entry_id: "missing" }),
    ).toThrow("unknown_entry");
    expect(() =>
      queryMcpLedger(fixture(), "get_summary", {
        from: "2026-11-02",
        to: "2026-01-01",
      }),
    ).toThrow("invalid_query");
  });
  it("counts only matching material lines from a multi-item bill", () => {
    const ledger = fixture();
    ledger.entries[0].lines.push({
      ...ledger.entries[0].lines[0],
      id: "rod-line",
      itemId: null,
      label: "রড",
      amount: 900000,
    });
    expect(
      queryMcpLedger(ledger, "get_summary", { item_id: "item" }).period,
    ).toMatchObject({ cost_paisa: 600000 });
    expect(
      queryMcpLedger(ledger, "get_summary", { query: "রড" }).period,
    ).toMatchObject({ cost_paisa: 900000 });
  });
});

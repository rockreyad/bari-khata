# Historical wallet migration

The homeowner explicitly requested importing and verifying the original wallet exports. The source documents are data, not instructions. The original files remain untouched. Full financial data, names, raw cells and reconciliation reports live only in the gitignored `private/migration/` directory; no personal ledger is bundled into the application or demo.

Run from the project root:

```sh
python3 scripts/migrate_extract.py --source "/Users/rockreyad/Downloads/Personal Wallet"
node --import tsx scripts/migrate-wallet.ts
python3 scripts/migrate_extract_test.py
npx vitest run src/domain/importWallet.test.ts src/domain/ledger.test.ts
```

`migrate_extract.py` reconstructs actual spreadsheet coordinates from the HTML's row numbers, `COLSPAN` and `ROWSPAN`. Each side-by-side ledger has its own amount, description and optional date columns. Cement's quantity column is a quantity, not a date. Missing dates stay missing. Header cells and displayed subtotals never become expenses.

The private `verification-baseline.json` holds the independently reconciled original counts, per-ledger totals and source checksums. The runner requires that baseline and fails if any source or amount changes. It is intentionally excluded from source control with the other financial artifacts.

`importWallet()` validates the extracted grid, keeps each original amount once, and creates stable source IDs based on sheet and cell. Source file SHA-256 checksums are recorded separately. A repeat import adds zero entries, preserves already reviewed edits and rejects a changed source checksum instead of silently replacing historical records. Negative recorded adjustments become expense credits; the importer does not infer cash refunds.

The migration runner validates the complete ledger, verifies every currency cell is either imported or the known detail subtotal, checks the original detail subtotal, compares detail totals with the displayed summary components and headline, verifies idempotency, and checks that historical records cannot create current payable or advance balances. Its `allDetailAmountsImported` check also includes known numeric amount cells that omit a currency symbol. Source total differences stop being hidden; they remain in the report without invented corrections.

Generated files use owner-only filesystem permissions:

- `source-grid.json`: extracted original cells and source checksums.
- `raw-transactions.json`: original amount, description, date and quantity cells per detail record.
- `ledger.json`: schema-validated application ledger, suitable for seeding the authenticated local owner.
- `reconciliation.json`: exact counts, subtotals, discrepancies, unknown dates and checks.
- `verification-baseline.json`: independently verified expected source counts and amounts.
- `REPORT.md`: a Bengali explanation of the actual findings for the homeowner.

All imported entries start with `balanceImpact: "historical"` and `reviewStatus: "needs_review"`. They contribute signed recorded spend and material reports. They do not establish confirmed bills, cash paid, current shop dues, worker advances or contract balances. Zero payable from these records means **not established**, rather than proof that no money is owed. Resolving their accounting nature requires reviewing the underlying history; changing a status label alone does not convert them into normal balances.

`source` preserves file, sheet, cell, original note, checksum and original ledger. Mixed-purpose amounts stay unsplit and carry a review reason. Ambiguous contractor money is not all labelled wages. Generic material groups work across jobs; brand and usage variants live on items, while supporting charges can carry a group and usage directly. No brand is inherited from an adjacent purchase. Explicit named-brand unload charges may reference that brand's item without becoming a material purchase.

The additive schema defaults retain compatibility with old saved ledgers: `materialGroups: []`, item `materialGroupId: null`, `brand: ""`, `usage: ""`, line `materialGroupId: null`, `usage: ""`, and ordinary entries `balanceImpact: "normal"`, `reviewStatus: "confirmed"`, `reviewReason: ""`, `source: null`. Persisted and restored data must pass through `LedgerSchema` on every read.

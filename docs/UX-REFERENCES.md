# UI reference and interaction decisions

Checked 1 November2026. These references informed the interaction patterns; the Bengali construction workflow is specific to this app.

- [Apple — Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables): compact, aligned rows that open focused details. The main transaction list uses compact rows and a short date including year; month headers belong in full history.
- [Linear — Issues and description history](https://linear.app/docs/creating-issues): a complete, inspectable change history. Every transaction revision remains accessible as before/after values; work status, dates and appearance changes have their own timeline.
- [Monzo — Exporting transactions](https://monzo.com/help/budgeting-overdrafts-savings/exporting-my-transactions): select a scope before exporting. A contact statement includes only that person and the selected account; the owner previews and downloads/shares it. Live links use the same scope with revocation.
- [Radix — Select](https://www.radix-ui.com/primitives/docs/components/select), [Popover](https://www.radix-ui.com/primitives/docs/components/popover), [Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu): keyboard controls, focus management, accessible labels and bounded menus, with the app's own visual styles.
- [DayPicker — Selection modes](https://daypicker.dev/docs/selection-modes/): a custom Bengali calendar. Small screens use a centred dialog so the month/year controls and final actions remain visible.

The daily actions are expense and payment. Returns are a shop-specific secondary action. Materials, wages, transport/unloading and other costs have separate report tabs. A new contact's type and chosen quick actions control the visible shortcuts. A work notebook can also choose its own shortcuts.

Money fields have an inline calculator. Arithmetic uses exact rational values and rounds once to integer poisha. Invalid expressions, division by zero, negative results and unsafe amounts cannot be applied.

## Palette revision

[Color Hunt — 2C3930 / 3F4F44 / A27B5C / DCD7C9](https://colorhunt.co/palette/2c39303f4f44a27b5cdcd7c9) supplies the earth-and-green foundation: dark green for text/actions, earthy brown for review notices and lighter derived beige for backgrounds. Four selectable palettes and light/dark/system appearance remain available. The previous internal `ocean` preference key stays compatible; its visible name is now “মাটি ও সবুজ”. Semantic material/wage/status colours remain distinguishable.

The calculator starts at zero, shows a large live money result and keeps the expression above it. Incomplete expressions show a dash; invalid expressions cannot be applied.

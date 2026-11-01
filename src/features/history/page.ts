import type { Ledger } from "../../domain/model";
import {
  filterHistory,
  historyGroups,
  sortHistory,
  type HistoryFilters,
  type HistoryOrder,
} from "./history";

export const HISTORY_PAGE_SIZE = 30;
export function historyPage(
  ledger: Ledger,
  filters: HistoryFilters,
  order: HistoryOrder,
  requestedPage: number,
  pageSize = HISTORY_PAGE_SIZE,
) {
  const entries = sortHistory(filterHistory(ledger, filters), order);
  const groups = historyGroups(entries);
  const size = Math.max(
    1,
    Math.min(100, Math.trunc(pageSize) || HISTORY_PAGE_SIZE),
  );
  const total = groups.entries.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const requested = Number.isSafeInteger(requestedPage) ? requestedPage : 1;
  const page = Math.min(pages, Math.max(1, requested));
  const selected = groups.entries.slice(0, page * size);
  const rows = selected.flatMap((entry) => [
    entry,
    ...(groups.payments.get(entry.id) ?? []),
  ]);
  return {
    rows,
    page,
    total,
    hasMore: selected.length < total,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { ZodError } from "zod";
import { readShare } from "./shareClient";
import {
  SharedStatementSchema,
  validateSharedPage,
  SHARED_QUERY_MAX_LENGTH,
  type SharedKind,
  type SharedStatement,
} from "./shareModel";

type Filter = SharedKind | "";
type ShareError =
  "" | "share_request_failed" | "share_changed" | "share_invalid_page";
type PageState = {
  statement: SharedStatement | null;
  pageStart: number;
  previousOffsets: number[];
  busy: boolean;
  missing: boolean;
  stale: boolean;
  error: ShareError;
};
const empty = (busy = false): PageState => ({
  statement: null,
  pageStart: 0,
  previousOffsets: [],
  busy,
  missing: false,
  stale: false,
  error: "",
});
const readToken = () => window.location.hash.slice(1);
const maxRows = 100000;
function contextOf(statement: SharedStatement) {
  const { rows: _rows, nextOffset: _nextOffset, ...context } = statement;
  return JSON.stringify(context);
}

export function useSharedStatement() {
  const [scope, setScope] = useState(() => ({
    token: readToken(),
    filter: "" as Filter,
    query: "",
    debounce: false,
  }));
  const activeScope = useRef(scope);
  const [page, setPage] = useState<PageState>(() => empty(true));
  const currentPage = useRef(page);
  const mounted = useRef(false);
  const generation = useRef(0);
  const locked = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const failedRequest = useRef<{
    offset: number;
    previousOffsets: number[];
    revision?: number;
  } | null>(null);
  const context = useRef<string | null>(null);
  const keyOffsets = useRef(new Map<string, number>());
  const publish = useCallback((value: PageState) => {
    currentPage.current = value;
    if (mounted.current) setPage(value);
  }, []);
  const invalidate = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    locked.current = false;
    failedRequest.current = null;
  }, []);
  const clear = useCallback(
    (value: PageState) => {
      invalidate();
      context.current = null;
      keyOffsets.current.clear();
      publish(value);
    },
    [invalidate, publish],
  );
  const markUnavailable = useCallback(() => {
    if (mounted.current) clear({ ...empty(), missing: true });
  }, [clear]);
  const markStale = useCallback(() => {
    if (mounted.current)
      clear({ ...empty(), stale: true, error: "share_changed" });
  }, [clear]);

  const requestPage = useCallback(
    async (offset: number, previousOffsets: number[], revision?: number) => {
      if (!mounted.current || locked.current) return;
      locked.current = true;
      failedRequest.current = null;
      const id = ++generation.current;
      const captured = activeScope.current;
      const abort = new AbortController();
      controller.current = abort;
      publish({ ...currentPage.current, busy: true, error: "" });
      const current = () =>
        mounted.current &&
        generation.current === id &&
        activeScope.current === captured &&
        readToken() === captured.token;
      try {
        const response = await readShare(
          captured.token,
          offset,
          revision,
          captured.filter || undefined,
          {
            signal: abort.signal,
            ...(captured.query ? { query: captured.query } : {}),
          },
        );
        if (!current()) return;
        if (!response) {
          markUnavailable();
          return;
        }
        const data = validateSharedPage(
          SharedStatementSchema.parse(response),
          offset,
          revision,
          captured.filter || undefined,
        );
        const nextContext = contextOf(data);
        if (context.current !== null && context.current !== nextContext)
          throw new Error("share_invalid_page");
        if (previousOffsets.length > maxRows)
          throw new Error("share_invalid_page");
        let newKeys = 0;
        for (const [index, row] of data.rows.entries()) {
          const ownedOffset = keyOffsets.current.get(row.key);
          if (ownedOffset !== undefined && ownedOffset !== offset + index)
            throw new Error("share_invalid_page");
          if (ownedOffset === undefined) newKeys++;
        }
        if (keyOffsets.current.size + newKeys > maxRows)
          throw new Error("share_invalid_page");
        context.current = nextContext;
        data.rows.forEach((row, index) =>
          keyOffsets.current.set(row.key, offset + index),
        );
        publish({
          statement: data,
          pageStart: offset,
          previousOffsets,
          busy: false,
          missing: false,
          stale: false,
          error: "",
        });
      } catch (cause) {
        if (!current()) return;
        if (cause instanceof Error && cause.message === "share_changed") {
          markStale();
          return;
        }
        const invalid =
          cause instanceof ZodError ||
          (cause instanceof Error && cause.message === "share_invalid_page");
        if (!invalid)
          failedRequest.current = { offset, previousOffsets, revision };
        publish({
          ...currentPage.current,
          busy: false,
          error: invalid ? "share_invalid_page" : "share_request_failed",
        });
      } finally {
        if (current()) {
          locked.current = false;
          controller.current = null;
        }
      }
    },
    [markStale, markUnavailable, publish],
  );
  const load = useCallback(async () => {
    if (!mounted.current) return;
    clear(empty(true));
    await requestPage(0, []);
  }, [clear, requestPage]);
  const retry = useCallback(async () => {
    if (!mounted.current || locked.current) return;
    const failed = failedRequest.current;
    if (failed && !currentPage.current.stale && !currentPage.current.missing)
      await requestPage(failed.offset, failed.previousOffsets, failed.revision);
    else await load();
  }, [load, requestPage]);
  const setFilter = useCallback(
    (filter: Filter) => {
      if (!mounted.current || activeScope.current.filter === filter) return;
      const previous = currentPage.current.statement;
      clear({
        ...empty(true),
        statement: previous
          ? { ...previous, rows: [], nextOffset: null }
          : null,
      });
      const next = { ...activeScope.current, filter, debounce: false };
      activeScope.current = next;
      setScope(next);
    },
    [clear],
  );
  const setQuery = useCallback(
    (value: string) => {
      const query = value.slice(0, SHARED_QUERY_MAX_LENGTH);
      if (!mounted.current || activeScope.current.query === query) return;
      const previous = currentPage.current.statement;
      clear({
        ...empty(true),
        statement: previous
          ? { ...previous, rows: [], nextOffset: null }
          : null,
      });
      const next = {
        ...activeScope.current,
        query,
        filter: "" as Filter,
        debounce: true,
      };
      activeScope.current = next;
      setScope(next);
    },
    [clear],
  );
  const next = useCallback(async () => {
    const before = currentPage.current;
    if (
      locked.current ||
      before.stale ||
      !before.statement ||
      before.statement.nextOffset === null
    )
      return;
    await requestPage(
      before.statement.nextOffset,
      [...before.previousOffsets, before.pageStart],
      before.statement.revision,
    );
  }, [requestPage]);
  const previous = useCallback(async () => {
    const before = currentPage.current;
    const offset = before.previousOffsets.at(-1);
    if (
      locked.current ||
      before.stale ||
      !before.statement ||
      offset === undefined
    )
      return;
    await requestPage(
      offset,
      before.previousOffsets.slice(0, -1),
      before.statement.revision,
    );
  }, [requestPage]);

  useEffect(() => {
    mounted.current = true;
    const change = () => {
      const token = readToken();
      if (token === activeScope.current.token) return;
      clear(empty(true));
      const next = { token, filter: "" as Filter, query: "", debounce: false };
      activeScope.current = next;
      setScope(next);
    };
    window.addEventListener("hashchange", change);
    change();
    return () => {
      mounted.current = false;
      window.removeEventListener("hashchange", change);
      invalidate();
      context.current = null;
      keyOffsets.current.clear();
      currentPage.current = empty();
    };
  }, [clear, invalidate]);
  useEffect(() => {
    if (!scope.debounce) {
      void requestPage(0, []);
      return;
    }
    const timer = window.setTimeout(() => void requestPage(0, []), 250);
    return () => window.clearTimeout(timer);
  }, [scope, requestPage]);

  return {
    token: scope.token,
    filter: scope.filter,
    setFilter,
    query: scope.query,
    setQuery,
    statement: page.statement,
    pageStart: page.pageStart,
    pageNumber: page.previousOffsets.length + 1,
    busy: page.busy,
    loading: page.busy && page.statement === null,
    error: page.error,
    missing: page.missing,
    stale: page.stale,
    canPrevious: !page.busy && !page.stale && page.previousOffsets.length > 0,
    canNext:
      !page.busy &&
      !page.stale &&
      page.statement !== null &&
      page.statement.nextOffset !== null,
    load,
    reload: load,
    retry,
    next,
    previous,
    markUnavailable,
    markStale,
  };
}

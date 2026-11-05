import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type FocusEvent,
} from "react";
export function useComposedInput(
  query: string,
  onCommit: (value: string) => void,
  { scope, restore = false }: { scope?: string; restore?: boolean } = {},
) {
  const [draft, setDraft] = useState({ value: query });
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const cancelled = useRef(false);
  const committed = useRef(query);
  const pending = useRef(new Set<string>());
  const previousScope = useRef(scope);

  useEffect(() => {
    const restored = restore && previousScope.current !== scope;
    previousScope.current = scope;
    if (restored) {
      composing.current = false;
      cancelled.current = true;
      pending.current.clear();
      committed.current = query;
      setDraft({ value: query });
      return;
    }
    if (query === committed.current) {
      pending.current.clear();
      return;
    }
    // An earlier value must not replace newer keyboard text.
    if (pending.current.has(query)) return;
    composing.current = false;
    cancelled.current = true;
    committed.current = query;
    setDraft({ value: query });
  }, [query, scope, restore]);

  const commit = (value: string) => {
    setDraft({ value });
    if (value === committed.current) return;
    committed.current = value;
    pending.current.add(value);
    onCommit(value);
  };
  const restoreText = () => setDraft({ value: committed.current });
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const native = event.nativeEvent as InputEvent;
    if (
      cancelled.current &&
      (native.isComposing || /composition/i.test(native.inputType ?? ""))
    ) {
      restoreText();
      return;
    }
    cancelled.current = false;
    const value = event.currentTarget.value;
    setDraft({ value });
    if (native.isComposing) composing.current = true;
    if (!composing.current) commit(value);
  };

  return {
    value: draft.value,
    getCommittedQuery: () => committed.current,
    inputProps: {
      ref: inputRef,
      value: draft.value,
      inputMode: "search" as const,
      enterKeyHint: "search" as const,
      autoComplete: "off",
      autoCapitalize: "none",
      autoCorrect: "off",
      spellCheck: false,
      onChange,
      onCompositionStart: () => {
        composing.current = true;
        cancelled.current = false;
      },
      onCompositionEnd: (event: CompositionEvent<HTMLInputElement>) => {
        composing.current = false;
        if (cancelled.current) restoreText();
        else commit(event.currentTarget.value);
      },
      onBlur: (event: FocusEvent<HTMLInputElement>) => {
        if (!composing.current) return;
        composing.current = false;
        commit(event.currentTarget.value);
      },
    },
    clear: () => {
      composing.current = false;
      cancelled.current = true;
      commit("");
      inputRef.current?.focus();
    },
  };
}

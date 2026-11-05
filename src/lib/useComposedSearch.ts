import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type FocusEvent,
} from "react";
import { useLocation, useNavigationType } from "react-router";

export function useComposedSearch(
  query: string,
  onCommit: (value: string) => void,
) {
  const [draft, setDraft] = useState({ value: query });
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const cancelled = useRef(false);
  const committed = useRef(query);
  const pending = useRef(new Set<string>());
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousLocation = useRef(location.key);

  useEffect(() => {
    const popped =
      navigationType === "POP" && previousLocation.current !== location.key;
    previousLocation.current = location.key;
    if (popped) {
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
    // An older URL transition must not replace newer keyboard text.
    if (pending.current.has(query)) return;
    composing.current = false;
    cancelled.current = true;
    committed.current = query;
    setDraft({ value: query });
  }, [query, location.key, navigationType]);

  const commit = (value: string) => {
    setDraft({ value });
    if (value === committed.current) return;
    committed.current = value;
    pending.current.add(value);
    onCommit(value);
  };
  const restore = () => setDraft({ value: committed.current });
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const native = event.nativeEvent as InputEvent;
    if (
      cancelled.current &&
      (native.isComposing || /composition/i.test(native.inputType ?? ""))
    ) {
      restore();
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
        if (cancelled.current) restore();
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

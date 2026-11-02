import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type Ref,
} from "react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { latinDigits } from "../../lib/numerals";
import { valueChange } from "./controlEvents";
import { acceptsNumericInput, type NumericKind } from "./numericPolicy";

export type NumericInputProps = ComponentPropsWithRef<"input"> & {
  numericKind?: NumericKind;
};
type Selection = {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
};
function assignRef(
  ref: Ref<HTMLInputElement> | undefined,
  input: HTMLInputElement | null,
) {
  if (typeof ref === "function") return ref(input);
  if (ref) ref.current = input;
}
export function NumericInput({
  value,
  defaultValue,
  onChange,
  onCompositionStart,
  onCompositionEnd,
  onBeforeInput,
  onKeyDown,
  onPaste,
  onSelect,
  ref,
  type = "text",
  inputMode,
  numericKind,
  name,
  ...props
}: NumericInputProps) {
  const { formatDigits } = useLanguageContext();
  const [internal, setInternal] = useState(() =>
    latinDigits(String(defaultValue ?? "")),
  );
  const [composition, setComposition] = useState<string | null>(null);
  const [, renderSelection] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  const compositionEnded = useRef<string | null>(null);
  const selection = useRef<Selection | null>(null);
  const beforeEdit = useRef<Selection | null>(null);
  const current = String(value === undefined ? internal : value);
  const kind =
    numericKind ??
    (inputMode === "numeric"
      ? "integer"
      : type === "tel" || inputMode === "tel"
        ? "phone"
        : "decimal");
  const setRef = useCallback(
    (element: HTMLInputElement | null) => {
      input.current = element;
      return assignRef(ref, element);
    },
    [ref],
  );
  // Script conversion changes the DOM value; keep the next key at the same caret.
  useLayoutEffect(() => {
    const next = selection.current;
    selection.current = null;
    if (!next || !input.current || document.activeElement !== input.current)
      return;
    const length = input.current.value.length;
    input.current.setSelectionRange(
      Math.min(next.start, length),
      Math.min(next.end, length),
      next.direction,
    );
  });
  function rememberSelection(element: HTMLInputElement) {
    if (element.selectionStart !== null && element.selectionEnd !== null)
      selection.current = {
        start: element.selectionStart,
        end: element.selectionEnd,
        direction: element.selectionDirection ?? "none",
      };
    renderSelection((previous) => previous + 1);
  }
  function rememberBeforeEdit(element: HTMLInputElement) {
    if (element.selectionStart !== null && element.selectionEnd !== null)
      beforeEdit.current = {
        start: element.selectionStart,
        end: element.selectionEnd,
        direction: element.selectionDirection ?? "none",
      };
  }
  function commit(element: HTMLInputElement) {
    setComposition(null);
    const canonical = latinDigits(element.value);
    if (!acceptsNumericInput(canonical, kind)) {
      let prefix = 0;
      const previous = latinDigits(current);
      while (
        prefix < previous.length &&
        prefix < canonical.length &&
        previous[prefix] === canonical[prefix]
      )
        prefix++;
      selection.current = beforeEdit.current ?? {
        start: prefix,
        end: prefix,
        direction: "none",
      };
      element.value = formatDigits(current);
      renderSelection((previous) => previous + 1);
      return previous;
    }
    rememberSelection(element);
    setInternal(canonical);
    onChange?.(valueChange<HTMLInputElement>(canonical, name));
    return canonical;
  }
  return (
    <input
      {...props}
      ref={setRef}
      name={name}
      placeholder={
        props.placeholder === undefined
          ? undefined
          : formatDigits(props.placeholder)
      }
      type={type === "number" ? "text" : type}
      inputMode={inputMode ?? (type === "tel" ? "tel" : "decimal")}
      value={composition ?? formatDigits(current)}
      onBeforeInput={(event) => {
        if (!composing.current) rememberBeforeEdit(event.currentTarget);
        onBeforeInput?.(event);
      }}
      onKeyDown={(event) => {
        if (!composing.current) rememberBeforeEdit(event.currentTarget);
        onKeyDown?.(event);
      }}
      onPaste={(event) => {
        rememberBeforeEdit(event.currentTarget);
        onPaste?.(event);
      }}
      onSelect={(event) => {
        if (!composing.current) rememberBeforeEdit(event.currentTarget);
        onSelect?.(event);
      }}
      onChange={(event) => {
        if (
          composing.current ||
          (event.nativeEvent as InputEvent).isComposing
        ) {
          setComposition(event.currentTarget.value);
          return;
        }
        // Some keyboards send one more input event after compositionend.
        const ended = compositionEnded.current;
        compositionEnded.current = null;
        if (
          ended !== null &&
          latinDigits(event.currentTarget.value) === ended
        ) {
          rememberSelection(event.currentTarget);
          return;
        }
        commit(event.currentTarget);
      }}
      onCompositionStart={(event) => {
        rememberBeforeEdit(event.currentTarget);
        composing.current = true;
        compositionEnded.current = null;
        setComposition(event.currentTarget.value);
        onCompositionStart?.(event);
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        setComposition(null);
        compositionEnded.current = commit(event.currentTarget);
        onCompositionEnd?.(event);
      }}
    />
  );
}

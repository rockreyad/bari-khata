import { localizedDigits } from "../../lib/numerals";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import * as Popover from "@radix-ui/react-popover";
import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { valueChange } from "./controlEvents";
import { normalizeLabel as normalized } from "../../lib/normalizeLabel";
import "./controls.css";

export type AppSuggestion = {
  id?: string;
  value: string;
  label?: string;
  description?: string;
};
export type AppComboboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "list"
> & {
  suggestions: readonly AppSuggestion[];
  fuzzy?: boolean;
  onSuggestionSelect?: (suggestion: AppSuggestion) => void;
};
export function comboboxSuggestions(
  suggestions: readonly AppSuggestion[],
): AppSuggestion[] {
  const unique = new Map<
    string,
    { id?: string; value: string; label?: string; descriptions: Set<string> }
  >();
  for (const suggestion of suggestions) {
    if (typeof suggestion.value !== "string" || !suggestion.value.trim())
      continue;
    const value = suggestion.value.trim();
    const key = JSON.stringify(
      suggestion.id ? ["id", suggestion.id] : ["value", normalized(value)],
    );
    const existing = unique.get(key);
    if (existing) {
      if (suggestion.description?.trim())
        existing.descriptions.add(suggestion.description.trim());
    } else
      unique.set(key, {
        ...(suggestion.id ? { id: suggestion.id } : {}),
        value,
        label: suggestion.label,
        descriptions: new Set(
          suggestion.description?.trim() ? [suggestion.description.trim()] : [],
        ),
      });
  }
  return [...unique.values()].map(({ id, value, label, descriptions }) => ({
    ...(id ? { id } : {}),
    value,
    label,
    description: [...descriptions].join(" · "),
  }));
}
export function matchingSuggestions(
  suggestions: readonly AppSuggestion[],
  query: string,
  limit = 8,
  fuzzy = false,
) {
  const terms = normalized(query).split(" ").filter(Boolean);
  return suggestions
    .filter((suggestion) => {
      const haystack = normalized(
        `${suggestion.value} ${suggestion.label ?? ""} ${suggestion.description ?? ""}`,
      );
      return terms.every(
        (term) =>
          haystack.includes(term) ||
          (fuzzy &&
            term.length >= 3 &&
            haystack.split(" ").some((word) => nearSuggestion(term, word))),
      );
    })
    .sort(
      (a, b) =>
        Number(normalized(b.value).startsWith(normalized(query))) -
        Number(normalized(a.value).startsWith(normalized(query))),
    )
    .slice(0, limit);
}

function nearSuggestion(a: string, b: string) {
  const limit = a.length >= 7 ? 2 : 1;
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(
        Math.min(
          next[j] + 1,
          previous[j + 1] + 1,
          previous[j] + Number(a[i] !== b[j]),
        ),
      );
    if (Math.min(...next) > limit) return false;
    previous = next;
  }
  return previous[b.length] <= limit;
}

export function AppCombobox({
  suggestions,
  fuzzy = false,
  onSuggestionSelect,
  value,
  defaultValue,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  className = "",
  style,
  disabled,
  readOnly,
  name,
  autoComplete,
  ...props
}: AppComboboxProps) {
  const { t, language } = useLanguageContext();
  const [internal, setInternal] = useState(String(defaultValue ?? ""));
  const current = String(value === undefined ? internal : value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const quietFocus = useRef(false);
  const id = useId();
  const listId = `${id}-suggestions`;
  const choices = useMemo(
    () => comboboxSuggestions(suggestions),
    [suggestions],
  );
  const shown = useMemo(
    () => matchingSuggestions(choices, current, 8, fuzzy),
    [choices, current, fuzzy],
  );
  const visible = open && !disabled && !readOnly && choices.length > 0;
  const choose = (suggestion: AppSuggestion) => {
    setInternal(suggestion.value);
    onChange?.(valueChange<HTMLInputElement>(suggestion.value, name));
    onSuggestionSelect?.(suggestion);
    setOpen(false);
    setActive(-1);
    quietFocus.current = true;
    input.current?.focus({ preventScroll: true });
    quietFocus.current = false;
  };
  useEffect(() => {
    if (visible && active >= 0)
      list.current
        ?.querySelector<HTMLElement>(`[data-suggestion-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, visible]);
  return (
    <Popover.Root
      open={visible}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setActive(-1);
      }}
    >
      <Popover.Anchor asChild>
        <span ref={anchor} className="app-combobox" style={style}>
          <input
            {...props}
            ref={input}
            name={name}
            value={current}
            className={className}
            disabled={disabled}
            readOnly={readOnly}
            autoComplete={autoComplete ?? "off"}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={visible}
            aria-controls={visible ? listId : undefined}
            aria-activedescendant={
              visible && active >= 0 && shown[active]
                ? `${id}-option-${active}`
                : undefined
            }
            onChange={(event) => {
              setInternal(event.target.value);
              setActive(-1);
              setOpen(true);
              onChange?.(event);
            }}
            onFocus={(event) => {
              onFocus?.(event);
              if (!quietFocus.current) {
                setActive(-1);
                setOpen(true);
              }
            }}
            onBlur={onBlur}
            onClick={() => {
              if (!disabled && !readOnly) setOpen(true);
            }}
            onKeyDown={(event) => {
              onKeyDown?.(event);
              if (
                event.defaultPrevented ||
                event.nativeEvent.isComposing ||
                disabled ||
                readOnly
              )
                return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                if (!shown.length) return;
                event.preventDefault();
                setOpen(true);
                setActive((previous) =>
                  event.key === "ArrowDown"
                    ? visible
                      ? Math.min(previous + 1, shown.length - 1)
                      : 0
                    : !visible || previous < 0
                      ? shown.length - 1
                      : Math.max(previous - 1, 0),
                );
              } else if (
                event.key === "Enter" &&
                visible &&
                active >= 0 &&
                shown[active]
              ) {
                event.preventDefault();
                event.stopPropagation();
                choose(shown[active]);
              } else if (event.key === "Escape" && visible) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setActive(-1);
              } else if (event.key === "Tab") {
                setOpen(false);
                setActive(-1);
              }
            }}
          />
          {choices.length && !readOnly ? (
            <CaretDownIcon
              className="app-combobox-caret"
              size={15}
              weight="bold"
              aria-hidden
            />
          ) : null}
        </span>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="app-combobox-popup"
          role="presentation"
          sideOffset={6}
          collisionPadding={12}
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (
              event.target instanceof Node &&
              anchor.current?.contains(event.target)
            )
              event.preventDefault();
          }}
          data-app-control-popup
        >
          <div className="combobox-caption">{t("আগে লেখা নাম")}</div>
          <div
            id={listId}
            ref={list}
            role="listbox"
            aria-label={t("আগে লেখা নাম")}
          >
            {shown.length ? (
              shown.map((suggestion, index) => (
                <div
                  key={suggestion.id ?? suggestion.value}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={active === index}
                  className={`app-combobox-option ${active === index ? "is-active" : ""}`}
                  data-suggestion-index={index}
                  onPointerMove={() => setActive(index)}
                  onPointerDown={(event) => {
                    if (event.pointerType === "mouse") event.preventDefault();
                  }}
                  onClick={() => choose(suggestion)}
                >
                  <span>
                    <strong>
                      {localizedDigits(
                        suggestion.label ?? suggestion.value,
                        language,
                      )}
                    </strong>
                    {suggestion.description ? (
                      <small>
                        {localizedDigits(suggestion.description, language)}
                      </small>
                    ) : null}
                  </span>
                  {!suggestion.id &&
                  normalized(suggestion.value) === normalized(current) ? (
                    <CheckIcon size={16} weight="bold" />
                  ) : null}
                </div>
              ))
            ) : (
              <div className="combobox-no-match">
                {t("এই নামেই লিখতে পারবেন")}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

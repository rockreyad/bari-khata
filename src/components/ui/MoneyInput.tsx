import { NumericInput } from "./NumericInput";
import {
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { AdaptivePopover } from "./AdaptivePopover";
import {
  ArrowRightIcon,
  BackspaceIcon,
  CalculatorIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  CalculatorError,
  evaluateMoneyExpression,
  normalizeExpression,
} from "./calculator";
import { valueChange } from "./controlEvents";
import "./controls.css";

export type MoneyInputProps = InputHTMLAttributes<HTMLInputElement>;
const errors = {
  empty: "প্রথমে একটি হিসাব লিখুন।",
  syntax: "হিসাবটি শেষ করুন। যেমন: ৫০০ + ২৫০।",
  zero: "শূন্য দিয়ে ভাগ করা যায় না।",
  negative: "টাকার ফল শূন্যের কম হতে পারবে না।",
  large: "এই অঙ্কটি অনেক বড়। একটু ছোট হিসাব করুন।",
};
export function MoneyInput({
  value,
  defaultValue,
  onChange,
  className = "",
  style,
  disabled,
  readOnly,
  name,
  onKeyDown,
  ...props
}: MoneyInputProps) {
  const { t, money, number } = useLanguageContext();
  const [internal, setInternal] = useState(String(defaultValue ?? ""));
  const current = String(value === undefined ? internal : value);
  const [open, setOpen] = useState(false);
  const [expression, setExpression] = useState("");
  const [showError, setShowError] = useState(false);
  const expressionRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  let result: ReturnType<typeof evaluateMoneyExpression> | null = null;
  let error = "";
  try {
    result = evaluateMoneyExpression(expression);
  } catch (cause) {
    error = t(errors[cause instanceof CalculatorError ? cause.code : "syntax"]);
  }
  const append = (text: string) => {
    setShowError(false);
    setExpression((previous) =>
      previous.length < 240 ? previous + text : previous,
    );
  };
  const calculate = () => {
    if (result) {
      setExpression(result.value);
      setShowError(false);
    } else setShowError(true);
  };
  const apply = () => {
    if (!result) {
      setShowError(true);
      return;
    }
    setInternal(result.value);
    onChange?.(valueChange<HTMLInputElement>(result.value, name));
    setOpen(false);
  };
  const keys = [
    "7",
    "8",
    "9",
    "÷",
    "4",
    "5",
    "6",
    "×",
    "1",
    "2",
    "3",
    "−",
    ".",
    "0",
    "=",
    "+",
  ];
  const expressionKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "=") {
      event.preventDefault();
      calculate();
    }
  };
  return (
    <span
      className={`money-control ${disabled ? "is-disabled" : ""}`}
      style={style}
    >
      <NumericInput
        {...props}
        value={current}
        name={name}
        className={className}
        disabled={disabled}
        readOnly={readOnly}
        inputMode={props.inputMode ?? "decimal"}
        onChange={(event) => {
          const next = event.target.value;
          setInternal(next);
          onChange?.(valueChange<HTMLInputElement>(next, name));
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (
            !event.defaultPrevented &&
            event.altKey &&
            event.key.toLowerCase() === "c"
          ) {
            event.preventDefault();
            setExpression(normalizeExpression(current));
            setShowError(false);
            setOpen(true);
          }
        }}
      />
      {!readOnly ? (
        <AdaptivePopover
          open={open}
          onOpenChange={(next) => {
            if (next) {
              setExpression(normalizeExpression(current));
              setShowError(false);
            }
            setOpen(next);
          }}
          className="money-calculator"
          title={t("হিসাব করি")}
          labelledBy={labelId}
          align="end"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            expressionRef.current?.focus();
          }}
          trigger={
            <button
              className="money-calculator-trigger"
              type="button"
              disabled={disabled}
              aria-label={t("হিসাব করার ক্যালকুলেটর")}
              title={t("ক্যালকুলেটর খুলুন")}
            >
              <CalculatorIcon size={22} weight="duotone" />
            </button>
          }
        >
          <div className="calculator-heading">
            <span id={labelId}>
              <CalculatorIcon size={20} weight="duotone" />
              {t("হিসাব করি")}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="control-popup-close"
              aria-label={t("বন্ধ করুন")}
            >
              <XIcon size={17} />
            </button>
          </div>
          <div className="calculator-display">
            <NumericInput
              ref={expressionRef}
              numericKind="expression"
              type="text"
              inputMode="none"
              value={expression}
              onChange={(event) => {
                setExpression(event.target.value.slice(0, 240));
                setShowError(false);
              }}
              onKeyDown={expressionKey}
              placeholder={number(0)}
              aria-label={t("ক্যালকুলেটরের হিসাব")}
              autoComplete="off"
              spellCheck={false}
            />
            <output
              aria-live="polite"
              className={!result && expression ? "is-pending" : undefined}
            >
              {result
                ? money(result.poisha)
                : expression.trim()
                  ? "—"
                  : money(0)}
            </output>
          </div>
          <div className="calculator-top-keys">
            <button
              type="button"
              onClick={() => {
                setExpression("");
                setShowError(false);
              }}
            >
              {t("সব মুছি")}
            </button>
            <button
              type="button"
              onClick={() => append("(")}
              aria-label={t("বন্ধনী শুরু")}
            >
              (
            </button>
            <button
              type="button"
              onClick={() => append(")")}
              aria-label={t("বন্ধনী শেষ")}
            >
              )
            </button>
            <button
              type="button"
              onClick={() => {
                setExpression((previous) => previous.slice(0, -1));
                setShowError(false);
              }}
              aria-label={t("শেষ সংখ্যাটি মুছি")}
            >
              <BackspaceIcon size={20} />
            </button>
          </div>
          <div className="calculator-keys">
            {keys.map((key) => (
              <button
                key={key}
                type="button"
                className={
                  /[÷×−+=]/.test(key)
                    ? `operator ${key === "=" ? "equals" : ""}`
                    : ""
                }
                onClick={() => (key === "=" ? calculate() : append(key))}
                aria-label={
                  key === "÷"
                    ? t("ভাগ")
                    : key === "×"
                      ? t("গুণ")
                      : key === "−"
                        ? t("বিয়োগ")
                        : key === "+"
                          ? t("যোগ")
                          : key === "="
                            ? t("ফল দেখুন")
                            : undefined
                }
              >
                {/^\d$/.test(key) ? number(Number(key)) : key}
              </button>
            ))}
          </div>
          {showError && error ? (
            <p className="calculator-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="calculator-apply" onClick={apply}>
            {t("এই টাকা লিখি")}
            <ArrowRightIcon size={18} weight="bold" />
          </button>
        </AdaptivePopover>
      ) : null}
    </span>
  );
}

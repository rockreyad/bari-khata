import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import { AdaptivePopover } from "./AdaptivePopover";
import { DayPicker } from "react-day-picker";
import { bn } from "react-day-picker/locale";
import {
  CalendarBlankIcon,
  CaretLeftIcon,
  CaretRightIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { todayDhaka } from "../../lib/display";
import { AppSelect } from "./AppSelect";
import { valueChange } from "./controlEvents";
import "./controls.css";

export type AppDatePickerProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & { type?: "date" };
export function calendarDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : undefined;
}
export function calendarValue(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
export function AppDatePicker({
  value,
  defaultValue,
  onChange,
  name,
  id,
  className = "",
  disabled,
  required,
  min,
  max,
  placeholder,
  style,
  title,
  "aria-label": label,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ...props
}: AppDatePickerProps) {
  const { t, language } = useLanguageContext();
  const [internal, setInternal] = useState(String(defaultValue ?? ""));
  const dateValue = String(value === undefined ? internal : value);
  const selected = calendarDate(dateValue);
  const today = calendarDate(todayDhaka())!;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const formField = useRef<HTMLInputElement>(null);
  const [month, setMonth] = useState(selected ?? today);
  const controlId = useId();
  const headingId = `${controlId}-heading`;
  const locale = language === "bn" ? "bn-BD" : "en-BD";
  const longDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [locale],
  );
  const shortDate = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    [locale],
  );
  const monthDate = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }),
    [locale],
  );
  const earliest = typeof min === "string" ? calendarDate(min) : undefined;
  const latest = typeof max === "string" ? calendarDate(max) : undefined;
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        new Intl.DateTimeFormat(locale, { month: "long" }).format(
          new Date(2024, index, 1),
        ),
      ),
    [locale],
  );
  const firstYear = Math.min(
    today.getFullYear() - 100,
    selected?.getFullYear() ?? today.getFullYear(),
    earliest?.getFullYear() ?? today.getFullYear(),
  );
  const lastYear = Math.max(
    today.getFullYear() + 15,
    selected?.getFullYear() ?? today.getFullYear(),
    latest?.getFullYear() ?? today.getFullYear(),
  );
  const yearNumber = new Intl.NumberFormat(locale, { useGrouping: false });
  const pick = (next: Date | undefined) => {
    const text = next ? calendarValue(next) : "";
    setInternal(text);
    onChange?.(valueChange<HTMLInputElement>(text, name));
    setOpen(false);
  };
  useEffect(() => {
    const valid =
      !dateValue ||
      Boolean(
        selected &&
        (!earliest || selected >= earliest) &&
        (!latest || selected <= latest),
      );
    formField.current?.setCustomValidity(
      valid ? "" : t("সঠিক তারিখ বেছে নিন।"),
    );
  }, [dateValue, min, max, t]);
  const todayAllowed =
    (!earliest || today >= earliest) && (!latest || today <= latest);
  const beforeAllowed =
    !earliest || new Date(month.getFullYear(), month.getMonth(), 0) >= earliest;
  const afterAllowed =
    !latest || new Date(month.getFullYear(), month.getMonth() + 1, 1) <= latest;
  return (
    <>
      <AdaptivePopover
        open={open}
        onOpenChange={(next) => {
          if (next) setMonth(selected ?? today);
          setOpen(next);
        }}
        className="app-date-popup"
        title={t("তারিখ বেছে নিন")}
        labelledBy={headingId}
        trigger={
          <button
            type="button"
            ref={trigger}
            id={id}
            className={`app-date-trigger ${!selected ? "is-empty" : ""} ${className}`}
            disabled={disabled}
            style={style}
            title={title}
            aria-label={label}
            aria-labelledby={labelledBy}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-required={required}
            data-control="date"
          >
            <CalendarBlankIcon size={19} weight="duotone" />
            <span>
              {selected
                ? shortDate.format(selected)
                : (placeholder ?? t("তারিখ বেছে নিন"))}
            </span>
            <span className="date-trigger-dot" />
          </button>
        }
      >
        <div className="app-date-heading">
          <span id={headingId}>{t("তারিখ বেছে নিন")}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="control-popup-close"
            aria-label={t("বন্ধ করুন")}
          >
            <XIcon size={17} />
          </button>
        </div>
        <div className="calendar-navigation">
          <button
            type="button"
            className="calendar-arrow"
            aria-label={t("আগের মাস")}
            disabled={!beforeAllowed}
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <CaretLeftIcon size={18} weight="bold" />
          </button>
          <AppSelect
            aria-label={t("মাস")}
            value={month.getMonth()}
            onChange={(event) =>
              setMonth(
                new Date(month.getFullYear(), Number(event.target.value), 1),
              )
            }
          >
            {months.map((name, index) => (
              <option key={index} value={index}>
                {name}
              </option>
            ))}
          </AppSelect>
          <AppSelect
            aria-label={t("বছর")}
            value={month.getFullYear()}
            onChange={(event) =>
              setMonth(
                new Date(Number(event.target.value), month.getMonth(), 1),
              )
            }
          >
            {Array.from(
              { length: lastYear - firstYear + 1 },
              (_, index) => firstYear + index,
            ).map((year) => (
              <option key={year} value={year}>
                {yearNumber.format(year)}
              </option>
            ))}
          </AppSelect>
          <button
            type="button"
            className="calendar-arrow"
            aria-label={t("পরের মাস")}
            disabled={!afterAllowed}
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <CaretRightIcon size={18} weight="bold" />
          </button>
        </div>
        <DayPicker
          mode="single"
          required
          selected={selected}
          onSelect={pick}
          month={month}
          onMonthChange={setMonth}
          hideNavigation
          showOutsideDays
          locale={language === "bn" ? bn : undefined}
          weekStartsOn={6}
          disabled={[
            ...(earliest ? [{ before: earliest }] : []),
            ...(latest ? [{ after: latest }] : []),
          ]}
          autoFocus
          classNames={{
            root: "app-calendar",
            months: "calendar-months",
            month: "calendar-month",
            month_caption: "calendar-native-caption",
            month_grid: "calendar-grid",
            weekdays: "calendar-weekdays",
            weekday: "calendar-weekday",
            week: "calendar-week",
            day: "calendar-day",
            day_button: "calendar-day-button",
            selected: "calendar-selected",
            today: "calendar-today",
            outside: "calendar-outside",
            disabled: "calendar-disabled",
          }}
          labels={{
            labelDayButton: (date) => longDate.format(date),
            labelGrid: (date) => monthDate.format(date),
          }}
          formatters={{
            formatDay: (date) => yearNumber.format(date.getDate()),
          }}
        />
        <div className="calendar-footer">
          <button
            type="button"
            disabled={!todayAllowed}
            onClick={() => pick(today)}
          >
            {t("আজ")}
          </button>
          {!required && dateValue ? (
            <button type="button" onClick={() => pick(undefined)}>
              {t("তারিখ বাদ দিন")}
            </button>
          ) : null}
        </div>
      </AdaptivePopover>
      {name || required ? (
        <input
          ref={formField}
          className="control-native-form-field"
          type="text"
          aria-hidden
          tabIndex={-1}
          name={name}
          value={dateValue}
          required={required}
          disabled={disabled}
          form={props.form}
          onChange={() => {}}
          onInvalid={(event) => {
            event.preventDefault();
            trigger.current?.focus();
            setMonth(selected ?? today);
            setOpen(true);
          }}
        />
      ) : null}
    </>
  );
}

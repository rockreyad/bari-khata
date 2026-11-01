import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type FocusEvent,
  type SelectHTMLAttributes,
} from "react";
import * as Select from "@radix-ui/react-select";
import { CaretDownIcon, CaretUpIcon, CheckIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { valueChange } from "./controlEvents";
import "./controls.css";

export type AppSelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "multiple" | "size"
>;
type Choice = {
  value: string;
  label: ReactNode;
  disabled: boolean;
  group: string;
};
const emptyValue = "__bari_empty_selection__";
const encode = (value: string) => (value === "" ? emptyValue : value);
const decode = (value: string) => (value === emptyValue ? "" : value);

export function selectChoices(children: ReactNode, group = ""): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{
        value?: string | number;
        children?: ReactNode;
        disabled?: boolean;
        label?: string;
      }>(child)
    )
      return [];
    if (child.type === Fragment)
      return selectChoices(child.props.children, group);
    if (child.type === "optgroup")
      return selectChoices(child.props.children, child.props.label ?? "");
    if (child.type !== "option") return [];
    const value =
      child.props.value ??
      (typeof child.props.children === "string" ? child.props.children : "");
    return [
      {
        value: String(value),
        label: child.props.children,
        disabled: Boolean(child.props.disabled),
        group,
      },
    ];
  });
}

export function AppSelect({
  children,
  value,
  defaultValue,
  onChange,
  onBlur,
  onFocus,
  className = "",
  id,
  name,
  disabled,
  required,
  autoFocus,
  form,
  style,
  title,
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  ...rest
}: AppSelectProps) {
  const { t } = useLanguageContext();
  const choices = useMemo(() => selectChoices(children), [children]);
  const initial =
    defaultValue === undefined
      ? (choices[0]?.value ?? "")
      : String(defaultValue);
  const [internal, setInternal] = useState(initial);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const current = value === undefined ? internal : String(value);
  const update = (next: string) => {
    setInternal(next);
    onChange?.(valueChange<HTMLSelectElement>(next, name));
  };
  let previousGroup = "";
  return (
    <Select.Root
      value={encode(current)}
      open={open}
      onOpenChange={setOpen}
      onValueChange={(next) => update(decode(next))}
      disabled={disabled}
    >
      <Select.Trigger
        ref={trigger}
        id={id}
        className={`app-select ${className}`}
        style={style}
        title={title}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-required={required}
        onFocus={(event) =>
          onFocus?.(event as unknown as FocusEvent<HTMLSelectElement>)
        }
        onBlur={(event) =>
          onBlur?.(event as unknown as FocusEvent<HTMLSelectElement>)
        }
        data-control="select"
        data-testid={
          "data-testid" in rest ? String(rest["data-testid"]) : undefined
        }
      >
        <Select.Value placeholder={t("বেছে নিন")} />
        <Select.Icon className="app-select-caret">
          <CaretDownIcon size={16} weight="bold" />
        </Select.Icon>
      </Select.Trigger>
      {name || required ? (
        <select
          className="control-native-form-field"
          aria-hidden
          tabIndex={-1}
          name={name}
          form={form}
          value={current}
          disabled={disabled}
          required={required}
          onChange={(event) => update(event.target.value)}
          onInvalid={(event) => {
            event.preventDefault();
            trigger.current?.focus();
            setOpen(true);
          }}
        >
          {choices.map((choice, index) => (
            <option
              key={`${choice.value}:${index}`}
              value={choice.value}
              disabled={choice.disabled}
            >
              {typeof choice.label === "string" ? choice.label : choice.value}
            </option>
          ))}
        </select>
      ) : null}
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={7}
          collisionPadding={12}
          className="app-select-popup"
          data-app-control-popup
        >
          <Select.ScrollUpButton className="app-select-scroll">
            <CaretUpIcon size={16} />
          </Select.ScrollUpButton>
          <Select.Viewport className="app-select-options">
            {choices.map((choice, index) => {
              const showGroup = choice.group && previousGroup !== choice.group;
              previousGroup = choice.group;
              return (
                <Fragment key={`${choice.value}:${index}`}>
                  {showGroup ? (
                    <div className="app-select-group">{choice.group}</div>
                  ) : null}
                  <Select.Item
                    className="app-select-option"
                    value={encode(choice.value)}
                    disabled={choice.disabled}
                  >
                    <Select.ItemText>{choice.label}</Select.ItemText>
                    <Select.ItemIndicator className="app-select-check">
                      <CheckIcon size={17} weight="bold" />
                    </Select.ItemIndicator>
                  </Select.Item>
                </Fragment>
              );
            })}
          </Select.Viewport>
          <Select.ScrollDownButton className="app-select-scroll">
            <CaretDownIcon size={16} />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

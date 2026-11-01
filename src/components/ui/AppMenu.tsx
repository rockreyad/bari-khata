import type { ReactElement, ReactNode } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { DotsThreeIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import "./controls.css";

export type AppMenuItem = {
  label: string;
  onSelect: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
};
export function AppMenu({
  trigger,
  label,
  items,
}: {
  trigger?: ReactElement;
  label?: string;
  items: AppMenuItem[];
}) {
  const { t } = useLanguageContext();
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger asChild>
        {trigger ?? (
          <button
            type="button"
            className="icon-button app-menu-trigger"
            aria-label={label ?? t("আরও")}
          >
            <DotsThreeIcon size={24} weight="bold" />
          </button>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="app-action-menu"
          sideOffset={8}
          collisionPadding={12}
          align="end"
          data-app-control-popup
        >
          {items.map((item, index) => (
            <div key={`${item.label}:${index}`}>
              {item.separatorBefore && index > 0 ? (
                <Menu.Separator className="app-menu-separator" />
              ) : null}
              <Menu.Item
                className={`app-action-menu-item ${item.danger ? "is-danger" : ""}`}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.icon ? (
                  <span className="app-menu-item-icon">{item.icon}</span>
                ) : null}
                <span>{item.label}</span>
              </Menu.Item>
            </div>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Drawer } from "vaul";
import { XIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";

export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useLanguageContext();
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const listener = () => setMobile(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);
  const close = (
    <button
      className="icon-button sheet-close"
      type="button"
      onClick={onClose}
      aria-label={t("বন্ধ করুন")}
    >
      <XIcon size={21} />
    </button>
  );
  if (mobile)
    return (
      <Drawer.Root
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        shouldScaleBackground={false}
        repositionInputs={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="sheet-overlay" />
          <Drawer.Content
            className="sheet-panel"
            aria-describedby={subtitle ? "drawer-description" : undefined}
          >
            <Drawer.Handle className="sheet-handle" />
            <header className="sheet-header">
              <div>
                <Drawer.Title asChild>
                  <h2>{title}</h2>
                </Drawer.Title>
                {subtitle ? (
                  <Drawer.Description id="drawer-description" className="muted">
                    {subtitle}
                  </Drawer.Description>
                ) : null}
              </div>
              {close}
            </header>
            <div className="sheet-content">{children}</div>
            {footer ? <footer className="sheet-footer">{footer}</footer> : null}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content
          className="sheet-panel"
          aria-describedby={subtitle ? "dialog-description" : undefined}
        >
          <header className="sheet-header">
            <div>
              <Dialog.Title asChild>
                <h2>{title}</h2>
              </Dialog.Title>
              {subtitle ? (
                <Dialog.Description id="dialog-description" className="muted">
                  {subtitle}
                </Dialog.Description>
              ) : null}
            </div>
            {close}
          </header>
          <div className="sheet-content">{children}</div>
          {footer ? <footer className="sheet-footer">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

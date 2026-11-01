import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import "./controls.css";

function useCompactViewport() {
  const [compact, setCompact] = useState(
    () =>
      typeof window !== "undefined" &&
      Boolean(window.matchMedia?.("(max-width: 760px)").matches),
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}

export function AdaptivePopover({
  open,
  onOpenChange,
  trigger,
  children,
  className,
  title,
  labelledBy,
  align = "start",
  onOpenAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
  className: string;
  title: string;
  labelledBy: string;
  align?: "start" | "center" | "end";
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const compact = useCompactViewport();
  if (compact)
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="control-mobile-overlay" />
          <Dialog.Content
            className={`${className} control-mobile-popup`}
            aria-labelledby={labelledBy}
            aria-describedby={undefined}
            onOpenAutoFocus={onOpenAutoFocus}
            data-app-control-popup
            data-control-layout="modal"
          >
            <Dialog.Title className="control-popup-accessible-title">
              {title}
            </Dialog.Title>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={className}
          sideOffset={9}
          collisionPadding={12}
          align={align}
          aria-labelledby={labelledBy}
          onOpenAutoFocus={onOpenAutoFocus}
          data-app-control-popup
          data-control-layout="popover"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

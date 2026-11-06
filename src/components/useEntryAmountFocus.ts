import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

export function useEntryAmountFocus(
  container: RefObject<HTMLElement | null>,
  ready: boolean | undefined,
) {
  const attempted = useRef(false);
  const interacted = useRef(false);
  const markInteraction = useCallback(() => {
    interacted.current = true;
  }, []);
  const focusAmount = useCallback(() => {
    if (!ready || attempted.current || interacted.current) return;
    const input = container.current?.querySelector<HTMLInputElement>(
      "input[data-entry-amount]:not(:disabled):not([readonly])",
    );
    if (!input) return;
    attempted.current = true;
    input.focus({ preventScroll: true });
    input.scrollIntoView?.({ block: "center" });
  }, [container, ready]);
  useLayoutEffect(focusAmount, [focusAmount]);
  useLayoutEffect(() => {
    if (ready === undefined) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const reveal = () => {
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement &&
        active.hasAttribute("data-entry-amount") &&
        container.current?.contains(active)
      ) {
        active.scrollIntoView?.({ block: "center" });
      }
    };
    viewport.addEventListener("resize", reveal);
    return () => viewport.removeEventListener("resize", reveal);
  }, [container, ready === undefined]);
  return { focusAmount, markInteraction };
}

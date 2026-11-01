import type { ChangeEvent } from "react";

export function valueChange<T extends HTMLInputElement | HTMLSelectElement>(
  value: string,
  name = "",
): ChangeEvent<T> {
  const target = { value, name } as T;
  return {
    target,
    currentTarget: target,
    type: "change",
    bubbles: true,
    cancelable: false,
    defaultPrevented: false,
    eventPhase: 3,
    isTrusted: false,
    nativeEvent: { type: "change" } as Event,
    timeStamp: Date.now(),
    preventDefault() {},
    stopPropagation() {},
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    persist() {},
  };
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import "./form-error.css";

export function useFormError() {
  const [notice, setNotice] = useState({ message: "", occurrence: 0 });
  const setError = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    setNotice((previous) => ({
      message: typeof next === "function" ? next(previous.message) : next,
      occurrence: previous.occurrence + 1,
    }));
  }, []);
  return [notice.message, setError, notice] as const;
}

export function FormError({
  message,
  occurrence = 0,
  className = "form-error",
  id,
}: {
  message: string;
  occurrence?: number;
  className?: string;
  id?: string;
}) {
  const element = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (
      !message ||
      !element.current ||
      element.current.closest('[inert], [aria-hidden="true"]')
    )
      return;
    element.current.focus({ preventScroll: true });
    element.current.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [message, occurrence]);
  return message ? (
    <p
      ref={element}
      id={id}
      className={`form-error-summary ${className}`}
      role="alert"
      tabIndex={-1}
    >
      {message}
    </p>
  ) : null;
}

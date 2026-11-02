import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TrashSimpleIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import { FormError, useFormError } from "./FormError";
import "./confirmation-dialog.css";

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  typedConfirmation,
  typedLabel,
  danger = true,
  busy = false,
  error,
  children,
  returnFocusRef,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  typedConfirmation?: "DELETE";
  typedLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string;
  children?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useLanguageContext();
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [failure, setFailure, failureNotice] = useFormError();
  const mounted = useRef(true);
  const lock = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const pending = busy || running;
  const matches =
    typedConfirmation === undefined || typed === typedConfirmation;
  const instruction =
    typedLabel ??
    t("নিশ্চিত করতে {{text}} লিখুন", { text: typedConfirmation ?? "" });
  const keywordAt =
    typedConfirmation === undefined
      ? -1
      : instruction.indexOf(typedConfirmation);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setTyped("");
    setFailure("");
  }, [typedConfirmation]);
  async function confirm() {
    if (!matches || pending || lock.current) return;
    lock.current = true;
    setRunning(true);
    setFailure("");
    try {
      await onConfirm();
    } catch {
      if (mounted.current) setFailure(t("কাজটি হয়নি। আবার চেষ্টা করুন।"));
    } finally {
      lock.current = false;
      if (mounted.current) setRunning(false);
    }
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && !pending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="confirmation-overlay" />
        <Dialog.Content
          className={`confirmation-dialog ${danger ? "is-danger" : ""}`}
          {...(description ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current ?? previousFocus.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          {danger ? (
            <span className="confirmation-symbol" aria-hidden="true">
              <TrashSimpleIcon size={25} weight="duotone" />
            </span>
          ) : null}
          <Dialog.Title className="confirmation-title">{title}</Dialog.Title>
          <FormError
            {...failureNotice}
            message={error || failure}
            className="confirmation-error"
          />
          {description ? (
            <Dialog.Description className="confirmation-copy">
              {description}
            </Dialog.Description>
          ) : null}
          {children}
          {typedConfirmation !== undefined ? (
            <label className="confirmation-type">
              <span>
                {keywordAt < 0 ? (
                  instruction
                ) : (
                  <>
                    {instruction.slice(0, keywordAt)}
                    <strong>{typedConfirmation}</strong>
                    {instruction.slice(keywordAt + typedConfirmation.length)}
                  </>
                )}
              </span>
              <input
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={pending}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </label>
          ) : null}
          <div className="confirmation-actions">
            <button
              type="button"
              className="confirmation-cancel"
              ref={cancel}
              disabled={pending}
              onClick={onClose}
            >
              {t("ফিরে যাই")}
            </button>
            <button
              type="button"
              className="confirmation-submit"
              disabled={!matches || pending}
              onClick={() => void confirm()}
            >
              {pending ? t("অপেক্ষা করুন…") : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CropIcon, XIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../context/LanguageProvider";
import {
  canCropImageSize,
  canCropReceiptImage,
  cropReceiptImage,
  type CropBounds,
} from "../lib/cropReceiptImage";
import { trackLocalWrite } from "../lib/localWriteBarrier";
import "./receipt-crop.css";

const fullImage: CropBounds = { left: 0, top: 0, right: 1, bottom: 1 };
const corners = {
  "top-left": "উপরের বাঁ কোণ",
  "top-right": "উপরের ডান কোণ",
  "bottom-left": "নিচের বাঁ কোণ",
  "bottom-right": "নিচের ডান কোণ",
} as const;
type Corner = keyof typeof corners;
type Grip = "move" | Corner;

const arrows = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function adjustBounds(
  bounds: CropBounds,
  grip: Grip,
  horizontal: number,
  vertical: number,
): CropBounds {
  const { left, top, right, bottom } = bounds;
  if (grip === "move") {
    const x = clamp(horizontal, -left, 1 - right);
    const y = clamp(vertical, -top, 1 - bottom);
    return {
      left: left + x,
      top: top + y,
      right: right + x,
      bottom: bottom + y,
    };
  }
  const minSpan = 0.08;
  return {
    left: grip.endsWith("left")
      ? clamp(left + horizontal, 0, right - minSpan)
      : left,
    top: grip.startsWith("top")
      ? clamp(top + vertical, 0, bottom - minSpan)
      : top,
    right: grip.endsWith("right")
      ? clamp(right + horizontal, left + minSpan, 1)
      : right,
    bottom: grip.startsWith("bottom")
      ? clamp(bottom + vertical, top + minSpan, 1)
      : bottom,
  };
}

export function ReceiptCropDialog({
  file,
  onClose,
  onCrop,
  returnFocus,
}: {
  file: File;
  onClose: () => void;
  onCrop: (file: File) => void | Promise<void>;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const { t } = useLanguageContext();
  const [source, setSource] = useState<{ file: File; url?: string }>();
  const [loaded, setLoaded] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  const [bounds, setBounds] = useState(fullImage);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  const [previousFocus] = useState(() => document.activeElement);
  const closeButton = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const locked = useRef(false);
  const mounted = useRef(false);
  const currentFile = useRef(file);
  currentFile.current = file;
  const drag = useRef<{
    id: number;
    grip: Grip;
    bounds: CropBounds;
    x: number;
    y: number;
    width: number;
    height: number;
  }>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setBounds(fullImage);
    setFailure(false);
    drag.current = null;
    const url =
      canCropReceiptImage(file) && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : undefined;
    setSource({ file, url });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  const url = source?.file === file ? source.url : undefined;
  const size = loaded && loaded.url === url ? loaded : undefined;
  const ready = size && canCropImageSize(size.width, size.height);
  const loadFailed = (source?.file === file && !url) || (size && !ready);
  const selectionStyle = {
    left: `${bounds.left * 100}%`,
    top: `${bounds.top * 100}%`,
    right: `${(1 - bounds.right) * 100}%`,
    bottom: `${(1 - bounds.bottom) * 100}%`,
  };

  function dragStart(event: PointerEvent<HTMLElement>, grip: Grip) {
    if (locked.current || drag.current || event.button !== 0 || !stage.current)
      return;
    const { width, height } = stage.current.getBoundingClientRect();
    if (!width || !height) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      grip,
      bounds,
      x: event.clientX,
      y: event.clientY,
      width,
      height,
    };
  }

  function dragMove(event: PointerEvent<HTMLElement>) {
    const start = drag.current;
    if (start?.id !== event.pointerId) return;
    setBounds(
      adjustBounds(
        start.bounds,
        start.grip,
        (event.clientX - start.x) / start.width,
        (event.clientY - start.y) / start.height,
      ),
    );
  }

  function dragEnd(event: PointerEvent<HTMLElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  function moveWithKeys(event: KeyboardEvent<HTMLElement>, grip: Grip) {
    if (locked.current || !Object.hasOwn(arrows, event.key)) return;
    event.preventDefault();
    const [x, y] = arrows[event.key as keyof typeof arrows];
    const step = event.shiftKey ? 0.05 : 0.01;
    setBounds((previous) => adjustBounds(previous, grip, x * step, y * step));
  }

  async function confirmCrop() {
    const photo = image.current;
    if (!ready || !photo || locked.current) return;
    locked.current = true;
    setPending(true);
    setFailure(false);
    try {
      await trackLocalWrite(
        (async () => {
          const cropped = await cropReceiptImage(file, photo, bounds);
          if (mounted.current && currentFile.current === file)
            await onCrop(cropped);
        })(),
      );
    } catch {
      if (mounted.current && currentFile.current === file) setFailure(true);
    } finally {
      locked.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !locked.current) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="receipt-crop-overlay" />
        <Dialog.Content
          className="receipt-crop-dialog"
          data-vaul-no-drag
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeButton.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus?.current ?? previousFocus;
            if (target instanceof HTMLElement && target.isConnected) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => {
            if (locked.current) event.preventDefault();
          }}
        >
          <header className="receipt-crop-heading">
            <div>
              <Dialog.Title>{t("ভাউচারের ছবি কাটুন")}</Dialog.Title>
              <Dialog.Description>
                {t("কাটার দাগগুলো টানুন। কিবোর্ডে তীর চেপেও সরাতে পারবেন।")}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="icon-button"
                ref={closeButton}
                aria-label={t("বন্ধ করুন")}
                disabled={pending}
              >
                <XIcon size={22} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          <div className="receipt-crop-workspace" aria-busy={pending}>
            {url ? (
              <div
                className="receipt-crop-image"
                ref={stage}
                style={
                  size && ready
                    ? {
                        aspectRatio: `${size.width} / ${size.height}`,
                        width: `min(100%, calc(var(--receipt-crop-height) * ${size.width / size.height}))`,
                      }
                    : undefined
                }
              >
                <img
                  ref={image}
                  src={url}
                  alt={t("ভাউচারের ছবি")}
                  draggable={false}
                  hidden={!ready}
                  onLoad={({ currentTarget }) =>
                    setLoaded({
                      url,
                      width: currentTarget.naturalWidth,
                      height: currentTarget.naturalHeight,
                    })
                  }
                  onError={() => setLoaded({ url, width: 0, height: 0 })}
                />
                {ready ? (
                  <>
                    <div className="receipt-crop-mask" aria-hidden="true">
                      <div style={selectionStyle} />
                    </div>
                    <div
                      className="receipt-crop-selection"
                      style={selectionStyle}
                    >
                      <div
                        className="receipt-crop-move"
                        role="group"
                        tabIndex={pending ? -1 : 0}
                        aria-label={t("কাটার জায়গা সরান")}
                        onKeyDown={(event) => moveWithKeys(event, "move")}
                        onPointerDown={(event) => dragStart(event, "move")}
                        onPointerMove={dragMove}
                        onLostPointerCapture={dragEnd}
                      />
                      {(Object.keys(corners) as Corner[]).map((corner) => (
                        <button
                          key={corner}
                          type="button"
                          className="receipt-crop-corner"
                          data-corner={corner}
                          aria-label={t(corners[corner])}
                          disabled={pending}
                          onKeyDown={(event) => moveWithKeys(event, corner)}
                          onPointerDown={(event) => dragStart(event, corner)}
                          onPointerMove={dragMove}
                          onLostPointerCapture={dragEnd}
                        />
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            {loadFailed ? (
              <p role="alert">{t("ছবিটি খোলা যায়নি।")}</p>
            ) : !ready ? (
              <p role="status">{t("অপেক্ষা করুন…")}</p>
            ) : null}
          </div>
          {failure ? (
            <p className="receipt-crop-error" role="alert">
              {t("ছবি কেটে রাখা যায়নি। আবার চেষ্টা করুন।")}
            </p>
          ) : null}
          <footer className="receipt-crop-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setBounds(fullImage);
                setFailure(false);
              }}
              disabled={!ready || pending}
            >
              {t("পুরো ছবি")}
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!ready || pending}
              onClick={() => void confirmCrop()}
            >
              <CropIcon size={18} aria-hidden="true" />
              {t(pending ? "অপেক্ষা করুন…" : "কেটে রাখুন")}
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

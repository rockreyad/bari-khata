import { useEffect, useRef, useState } from "react";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
} from "pdfjs-dist";
import { useLanguageContext } from "../context/LanguageProvider";

export function ReceiptPdfPreview({ file, url }: { file: Blob; url: string }) {
  const { t, number } = useLanguageContext();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [page, setPage] = useState(1);
  const [readyPage, setReadyPage] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    void Promise.all([
      file.arrayBuffer(),
      import("pdfjs-dist/legacy/build/pdf.mjs"),
      import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"),
    ])
      .then(async ([data, library, worker]) => {
        if (cancelled) return;
        library.GlobalWorkerOptions.workerSrc = worker.default;
        task = library.getDocument({
          data,
          maxImageSize: 50_000_000,
          canvasMaxAreaInBytes: 24_000_000,
        });
        const document = await task.promise;
        if (!cancelled) setPdf(document);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      void task?.destroy().catch(() => {});
    };
  }, [file]);

  useEffect(() => {
    const surface = canvas.current;
    if (!pdf || !surface || failed) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    void pdf
      .getPage(page)
      .then(async (documentPage) => {
        if (cancelled) return;
        const original = documentPage.getViewport({ scale: 1 });
        const viewport = documentPage.getViewport({
          scale: Math.min(1320 / original.width, 1750 / original.height),
        });
        surface.width = Math.ceil(viewport.width);
        surface.height = Math.ceil(viewport.height);
        render = documentPage.render({ canvas: surface, viewport });
        await render.promise;
        if (!cancelled) setReadyPage(page);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [failed, page, pdf]);

  if (failed)
    return (
      <div className="receipt-preview-message" role="alert">
        <p>{t("এই PDF এখানে দেখা যাচ্ছে না।")}</p>
        <a
          className="secondary-button"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("অন্যভাবে খুলুন")}
        </a>
      </div>
    );

  return (
    <div className="receipt-pdf">
      <div className="receipt-pdf-page">
        {readyPage !== page && <p role="status">{t("অপেক্ষা করুন…")}</p>}
        <canvas
          ref={canvas}
          hidden={readyPage !== page}
          role="img"
          aria-label={t("PDF-এর পাতা {{page}}", { page: number(page) })}
        />
      </div>
      {pdf && pdf.numPages > 1 && (
        <nav className="receipt-pdf-navigation" aria-label={t("PDF-এর পাতা")}>
          <button
            type="button"
            className="icon-button"
            aria-label={t("আগের পাতা")}
            disabled={page === 1 || readyPage !== page}
            onClick={() => setPage((current) => current - 1)}
          >
            <CaretLeftIcon size={18} aria-hidden="true" />
          </button>
          <span aria-live="polite">
            {number(page)} / {number(pdf.numPages)}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t("পরের পাতা")}
            disabled={page === pdf.numPages || readyPage !== page}
            onClick={() => setPage((current) => current + 1)}
          >
            <CaretRightIcon size={18} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}

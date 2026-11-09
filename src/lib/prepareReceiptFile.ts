import { z } from "zod";
import {
  NEW_RECEIPT_MAX_BYTES,
  RECEIPT_IMAGE_SOURCE_MAX_BYTES,
} from "./attachmentLimits";

const receiptType = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const smallImageBytes = 180 * 1024;
const maximumPixels = 50_000_000;
const attempts = [
  { edge: 2400, quality: 0.84 },
  { edge: 2000, quality: 0.78 },
  { edge: 1600, quality: 0.72 },
];

export async function prepareReceiptFile(file: File): Promise<File> {
  if (!receiptType.safeParse(file.type).success)
    throw new Error("receipt_type_invalid");
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new Error("receipt_empty");
  if (file.type === "application/pdf") {
    // Re-encoding a PDF can discard signatures, selectable text or pages.
    if (file.size > NEW_RECEIPT_MAX_BYTES) throw new Error("receipt_too_large");
    return file;
  }
  if (file.size > RECEIPT_IMAGE_SOURCE_MAX_BYTES)
    throw new Error("receipt_source_too_large");
  if (file.size < smallImageBytes) return file;

  const url = URL.createObjectURL(file);
  const photo = new Image();
  const canvas = document.createElement("canvas");
  try {
    photo.src = url;
    try {
      await photo.decode();
    } catch {
      throw new Error("receipt_image_unreadable");
    }
    const width = photo.naturalWidth;
    const height = photo.naturalHeight;
    if (!width || !height) throw new Error("receipt_image_unreadable");
    if (width * height > maximumPixels)
      throw new Error("receipt_image_too_large");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("receipt_image_unreadable");

    for (const { edge, quality } of attempts) {
      const scale = Math.min(1, edge / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(photo, 0, 0, canvas.width, canvas.height);
      const result = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (
        !result ||
        result.size === 0 ||
        !["image/jpeg", "image/png", "image/webp"].includes(result.type)
      )
        throw new Error("receipt_image_unreadable");
      if (result.size >= file.size && file.size <= NEW_RECEIPT_MAX_BYTES)
        return file;
      if (result.size <= NEW_RECEIPT_MAX_BYTES) {
        const extension =
          result.type === "image/jpeg" ? "jpg" : result.type.slice(6);
        return new File(
          [result],
          `${file.name.replace(/\.[^.]+$/, "")}.${extension}`,
          { type: result.type, lastModified: file.lastModified },
        );
      }
    }
    throw new Error("receipt_too_large");
  } finally {
    photo.src = "";
    canvas.width = 0;
    canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}

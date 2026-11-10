import {
  NEW_RECEIPT_MAX_BYTES,
  RECEIPT_IMAGE_SOURCE_MAX_BYTES,
} from "./attachmentLimits";

export type CropBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const imageExtensions = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
} as const;

function isCropMime(type: string): type is keyof typeof imageExtensions {
  return Object.hasOwn(imageExtensions, type);
}

export function canCropReceiptImage(file: Blob) {
  return (
    isCropMime(file.type) &&
    file.size > 0 &&
    file.size <= RECEIPT_IMAGE_SOURCE_MAX_BYTES
  );
}

export function canCropImageSize(width: number, height: number) {
  return width > 0 && height > 0 && width * height <= 50_000_000;
}

export async function cropReceiptImage(
  file: File,
  photo: HTMLImageElement,
  { left, top, right, bottom }: CropBounds,
): Promise<File> {
  const width = photo.naturalWidth;
  const height = photo.naturalHeight;
  if (
    !canCropReceiptImage(file) ||
    !canCropImageSize(width, height) ||
    ![left, top, right, bottom].every(
      (edge) => Number.isFinite(edge) && edge >= 0 && edge <= 1,
    ) ||
    left >= right ||
    top >= bottom
  )
    throw new Error("receipt_crop_invalid");

  const x = Math.min(width - 1, Math.round(left * width));
  const y = Math.min(height - 1, Math.round(top * height));
  const cropWidth = Math.max(1, Math.round(right * width) - x);
  const cropHeight = Math.max(1, Math.round(bottom * height) - y);
  if (
    cropWidth === width &&
    cropHeight === height &&
    file.size <= NEW_RECEIPT_MAX_BYTES
  )
    return file;

  const canvas = document.createElement("canvas");
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("receipt_crop_unavailable");
    for (const maxEdge of [2400, 2000, 1600]) {
      const scale = Math.min(1, maxEdge / Math.max(cropWidth, cropHeight));
      canvas.width = Math.max(1, Math.round(cropWidth * scale));
      canvas.height = Math.max(1, Math.round(cropHeight * scale));
      context.imageSmoothingQuality = "high";
      context.drawImage(
        photo,
        x,
        y,
        cropWidth,
        cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, file.type, 0.9),
      );
      if (
        !blob ||
        !isCropMime(blob.type) ||
        blob.size === 0 ||
        blob.size > NEW_RECEIPT_MAX_BYTES
      )
        continue;
      const extensions: readonly string[] = imageExtensions[blob.type];
      const lastDot = file.name.lastIndexOf(".");
      const extension = file.name.slice(lastDot + 1).toLowerCase();
      const name =
        lastDot > 0 && extensions.includes(extension)
          ? file.name
          : `${lastDot > 0 ? file.name.slice(0, lastDot) : file.name}.${extensions[0]}`;
      return new File([blob], name, {
        type: blob.type,
        lastModified: file.lastModified,
      });
    }
    throw new Error("receipt_crop_unavailable");
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

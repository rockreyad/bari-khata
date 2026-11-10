import { z } from "zod";
import { todayDhaka } from "./display";

export const voucherExtensions: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const isoDate = z.iso.date();

export function voucherFilename(
  order: number,
  date: string | null | undefined,
  createdAt: string | undefined,
  mime: string,
) {
  const created = createdAt ? new Date(createdAt) : null;
  const recordedDate = isoDate.safeParse(date);
  const localDate = recordedDate.success
    ? recordedDate.data
    : created && Number.isFinite(created.getTime())
      ? todayDhaka(created)
      : "undated";
  const extension = Object.hasOwn(voucherExtensions, mime)
    ? voucherExtensions[mime]
    : "bin";
  return `voucher-${order}-${localDate}.${extension}`;
}

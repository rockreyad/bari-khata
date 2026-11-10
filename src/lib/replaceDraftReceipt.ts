export function replaceDraftReceipt<T extends { id: string; file: Blob }>(
  receipts: T[],
  id: string,
  original: Blob,
  file: File,
): T[] {
  const index = receipts.findIndex(
    (receipt) => receipt.id === id && receipt.file === original,
  );
  const current = receipts[index];
  if (!current) throw new Error("receipt_changed");
  const next = [...receipts];
  next[index] = { ...current, file, name: file.name };
  return next;
}

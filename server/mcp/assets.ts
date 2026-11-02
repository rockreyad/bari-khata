import { LedgerSchema, type Receipt } from "../../src/domain/model.js";
import { McpError, sha256 } from "./common.js";
import type { Asset, McpStore, Principal } from "./store.js";

export function ledgerReceipts(principal: Principal): Receipt[] {
  if (!principal.snapshot.document) return [];
  const ledger = LedgerSchema.parse(principal.snapshot.document);
  const receipts = new Map<string, Receipt>();
  for (const entry of ledger.entries)
    for (const snapshot of [
      entry,
      ...entry.revisions.map((revision) => revision.before),
    ])
      for (const receipt of snapshot.receipts)
        receipts.set(receipt.id, receipt);
  return [...receipts.values()];
}
export async function readableAsset(
  store: McpStore,
  principal: Principal,
  tokenHash: string,
  resource: string,
  id: string,
): Promise<Asset> {
  // Storage normalizes URL paths, so IDs must stay within one object-key segment.
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id))
    throw new McpError("invalid_receipt", 400);
  const path = `${principal.connection.ownerId}/${id}`;
  try {
    const asset = await store.call<Asset>("asset", { tokenHash, resource, id });
    if (
      asset.ownerId !== principal.connection.ownerId ||
      asset.id !== id ||
      asset.path !== path
    )
      throw new McpError("file_integrity_error", 409);
    return asset;
  } catch (error) {
    if (!(error instanceof McpError) || !/not_found/.test(error.code))
      throw error;
    const receipt = ledgerReceipts(principal).find(
      (candidate) => candidate.id === id,
    );
    if (!receipt) throw new McpError("file_not_found", 404);
    const bytes = await store.download(path);
    if (bytes.length !== receipt.size)
      throw new McpError("file_integrity_error", 409);
    return {
      ...receipt,
      ownerId: principal.connection.ownerId,
      connectionId: null,
      path,
      sha256: sha256(bytes),
      status: "uploaded",
      immutable: false,
    };
  }
}

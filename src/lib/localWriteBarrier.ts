const pending = new Set<Promise<unknown>>();
const latest = new Map<string, symbol>();
const failedDrafts = new Set<string>();
let financialWritesAllowed = true;

export function setFinancialWritesAllowed(allowed: boolean) {
  financialWritesAllowed = allowed;
}

export function assertFinancialWritesAllowed() {
  if (!financialWritesAllowed) throw new Error("client_update_required");
}

export function draftWriteKey(database: string, mode: string, key: string) {
  return JSON.stringify([database, mode, key]);
}

export function trackLocalWrite<T>(
  operation: PromiseLike<T>,
  draftKey?: string,
) {
  const promise = Promise.resolve(operation);
  const token = Symbol();
  if (draftKey) latest.set(draftKey, token);
  pending.add(promise);
  void promise.then(
    () => {
      pending.delete(promise);
      if (draftKey && latest.get(draftKey) === token) {
        failedDrafts.delete(draftKey);
        latest.delete(draftKey);
      }
    },
    () => {
      pending.delete(promise);
      if (draftKey && latest.get(draftKey) === token)
        failedDrafts.add(draftKey);
    },
  );
  return promise;
}

export async function waitForLocalWrites() {
  for (;;) {
    // Editor cleanup can chain catch/then before registering its final draft.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const writes = [...pending];
    if (!writes.length) {
      if (failedDrafts.size) throw new Error("draft_flush_failed");
      return;
    }
    const results = await Promise.allSettled(writes);
    if (results.some((result) => result.status === "rejected"))
      throw new Error("local_write_failed");
  }
}

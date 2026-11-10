const blobStorageMessage =
  "Error preparing Blob/File data to be stored in object store";

export function isBlobStorageError(error: unknown): boolean {
  function matches(value: unknown, parents: Set<object>): boolean {
    if (!value || typeof value !== "object" || parents.has(value)) return false;
    const { name, message, cause, inner, failures } = value as {
      name?: unknown;
      message?: unknown;
      cause?: unknown;
      inner?: unknown;
      failures?: unknown;
    };
    if (
      name === "UnknownError" &&
      typeof message === "string" &&
      message
        .split("\n")
        .some(
          (line) =>
            line.trim() === blobStorageMessage ||
            line.trim() === `UnknownError: ${blobStorageMessage}`,
        )
    )
      return true;
    const next = new Set(parents).add(value);
    if (name === "BulkError" && Array.isArray(failures))
      return (
        failures.length > 0 && failures.every((item) => matches(item, next))
      );
    return matches(cause, next) || matches(inner, next);
  }
  return matches(error, new Set());
}

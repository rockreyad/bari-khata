import type { AddOptions } from "./NotebookContext";
import { entryReturn, entryUrl } from "./entryRoutes";

export function houseWriteUrl(
  base: string,
  options: AddOptions = {},
  back = `${base}/`,
) {
  if (options.editId || options.kind === "refund" || options.kind === "return")
    return entryUrl(base, options, back);
  const action =
    options.kind === "payment" &&
    !["wage", "charge"].includes(options.purpose ?? "")
      ? "payment"
      : options.kind === "wage" ||
          options.purpose === "charge" ||
          options.purpose === "wage" ||
          (options.costType && options.costType !== "material") ||
          options.account === "labour"
        ? "charge"
        : "purchase";
  const params = new URLSearchParams({ back: entryReturn(back, base) });
  for (const [key, value] of Object.entries({
    work: options.workId,
    person: options.personId,
    account: options.account,
    type: options.costType,
    purpose: options.purpose,
    contract: options.contractId,
  }))
    if (value) params.set(key, value);
  return `${base}/write/${action}?${params}`;
}

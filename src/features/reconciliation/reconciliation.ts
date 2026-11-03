import { contractUrl, entryUrl } from "../../app/entryRoutes";

export type ReconciliationType = "bill" | "payment" | "contract";
export function reconciliationEditUrl(
  base: string,
  type: ReconciliationType,
  id: string,
  back = `${base}/reconcile`,
) {
  const path =
    type === "contract"
      ? contractUrl(base, id, undefined, undefined, back)
      : entryUrl(base, { editId: id }, back);
  const url = new URL(path, "https://bari.invalid");
  url.searchParams.set("reconcile", "1");
  return `${url.pathname}${url.search}`;
}

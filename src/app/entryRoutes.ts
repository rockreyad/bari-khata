import type { AddOptions } from "./NotebookProvider";
const modalKeys = [
  "_add",
  "_entity",
  "_edit",
  "_entry",
  "_work",
  "_person",
  "_account",
  "_type",
  "_purpose",
  "_quick",
];
export function entryReturn(path: string | null | undefined, base = "") {
  if (!path || !path.startsWith("/") || path.startsWith("//"))
    return `${base}/`;
  try {
    const url = new URL(path, "https://bari.invalid");
    if (url.origin !== "https://bari.invalid") return `${base}/`;
    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`))
      return `${base}/`;
    const relative = base ? url.pathname.slice(base.length) : url.pathname;
    const jobPage =
      /^\/jobs(?:\/[^/]+)?$/.test(relative) && relative !== "/jobs/new";
    if (
      !jobPage &&
      !/^(?:\/(?:works|people|ledger|reports|materials|review|settings|timeline)(?:\/[^/]*)*|\/)?$/.test(
        relative,
      )
    )
      return `${base}/`;
    for (const key of modalKeys) url.searchParams.delete(key);
    return `${url.pathname}${url.search}`;
  } catch {
    return `${base}/`;
  }
}
export function entryUrl(
  base: string,
  options: AddOptions = {},
  back = `${base}/`,
) {
  const params = new URLSearchParams({
    kind: options.kind ?? "expense",
    back: entryReturn(back, base),
  });
  for (const [key, value] of Object.entries({
    work: options.workId,
    person: options.personId,
    account: options.account,
    type: options.costType,
    purpose: options.purpose,
    contract: options.contractId,
  }))
    if (value) params.set(key, value);
  const path = options.editId
    ? `/entries/${encodeURIComponent(options.editId)}/edit`
    : "/entries/new";
  return `${base}${path}?${params}`;
}
export function contractUrl(
  base: string,
  id?: string,
  workId?: string,
  personId?: string,
  back = `${base}/`,
) {
  const params = new URLSearchParams({ back: entryReturn(back, base) });
  if (workId) params.set("work", workId);
  if (personId) params.set("person", personId);
  return `${base}/jobs/${id ? `${encodeURIComponent(id)}/edit` : "new"}?${params}`;
}

export function isEntryPage(pathname: string) {
  return /\/(?:entries|contracts|jobs)\/(?:new|[^/]+\/edit)\/?$/.test(pathname);
}

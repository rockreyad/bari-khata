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

export function canonicalNotebookPath(path: string) {
  return path
    .replace(/^\/people(?=\/|$)/, "/parties")
    .replace(/^\/(?:jobs|contracts)(?=\/|$)/, "/works");
}

export function entryReturn(path: string | null | undefined, base = "") {
  if (!path || !path.startsWith("/") || path.startsWith("//"))
    return `${base}/`;
  try {
    const url = new URL(path, "https://bari.invalid");
    if (url.origin !== "https://bari.invalid") return `${base}/`;
    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`))
      return `${base}/`;
    if (isEntryPage(url.pathname)) return `${base}/`;
    const relative = canonicalNotebookPath(
      base ? url.pathname.slice(base.length) : url.pathname,
    );
    if (
      relative !== "/timeline" &&
      !/^\/dues\/?$/.test(relative) &&
      !/^(?:\/(?:sectors|works|parties|ledger|history|more|reports|materials|review|settings)(?:\/[^/]*)*|\/)?$/.test(
        relative,
      )
    )
      return `${base}/`;
    for (const key of modalKeys) url.searchParams.delete(key);
    return `${base}${relative}${url.search}${url.hash}`;
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
  return `${base}${options.editId ? `/entries/${encodeURIComponent(options.editId)}/edit` : "/entries/new"}?${params}`;
}

export function contractUrl(
  base: string,
  id?: string,
  workId?: string,
  personId?: string,
  back = `${base}/works`,
) {
  const params = new URLSearchParams({ back: entryReturn(back, base) });
  if (workId) params.set("work", workId);
  if (personId) params.set("person", personId);
  return `${base}/works/${id ? `${encodeURIComponent(id)}/edit` : "new"}?${params}`;
}

export function personUrl(
  base: string,
  id?: string,
  workId?: string,
  personId?: string,
  back = `${base}/parties`,
) {
  const params = new URLSearchParams({ back: entryReturn(back, base) });
  if (workId) params.set("work", workId);
  if (personId) params.set("person", personId);
  return `${base}/parties/${id ? `${encodeURIComponent(id)}/edit` : "new"}?${params}`;
}

export function sectorUrl(base: string, id?: string, back = `${base}/sectors`) {
  return `${base}/sectors/${id ? `${encodeURIComponent(id)}/edit` : "new"}?${new URLSearchParams({ back: entryReturn(back, base) })}`;
}

export const isPersonFormPage = (pathname: string) =>
  /\/(?:parties|people)\/(?:new|[^/]+\/edit)\/?$/.test(pathname);
export const isSectorFormPage = (pathname: string) =>
  /\/sectors\/(?:new|[^/]+\/edit)\/?$/.test(pathname);
export function isEntryPage(pathname: string) {
  return (
    /\/write\/(?:purchase|charge|payment)\/?$/.test(pathname) ||
    /\/(?:entries|works|sectors|contracts|jobs|parties|people)\/(?:new|[^/]+\/edit)\/?$/.test(
      pathname,
    )
  );
}

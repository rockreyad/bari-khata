import { canonicalNotebookPath, isEntryPage } from "./entryRoutes";
function originPath(origin: string | null | undefined, base: string) {
  if (!origin?.startsWith("/") || origin.startsWith("//")) return null;
  try {
    const url = new URL(origin, "https://bari.invalid");
    if (url.origin !== "https://bari.invalid") return null;
    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`))
      return null;
    const relative =
      (base ? url.pathname.slice(base.length) : url.pathname) || "/";
    if (isEntryPage(relative)) return null;
    let path = canonicalNotebookPath(relative);
    if (
      /^\/works\/[^/]+\/?$/.test(path) &&
      ["material", "labour", "activity"].includes(
        url.searchParams.get("tab") ?? "",
      )
    )
      path = path.replace(/^\/works/, "/sectors");
    if (!/^(?:\/(?:parties|sectors)(?:\/[^/]+)?\/?|\/works\/?|\/)$/.test(path))
      return null;
    for (const key of [...url.searchParams.keys()])
      if (key.startsWith("_")) url.searchParams.delete(key);
    return `${path}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
export function jobDetailUrl(jobId: string, origin: string, base = "") {
  const back = originPath(origin, base) ?? "/works";
  return `/works/${encodeURIComponent(jobId)}?${new URLSearchParams({ back: `${base}${back}` })}`;
}
export function jobReturn(
  back: string | null | undefined,
  base = "",
  fallback = "/works",
) {
  return (
    originPath(back, base) ?? originPath(`${base}${fallback}`, base) ?? "/works"
  );
}

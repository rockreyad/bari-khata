import { isPersonFormPage } from "./entryRoutes";

function originPath(origin: string | null | undefined, base: string) {
  if (!origin?.startsWith("/") || origin.startsWith("//")) return null;
  try {
    const url = new URL(origin, "https://bari.invalid");
    if (url.origin !== "https://bari.invalid") return null;
    if (base && url.pathname !== base && !url.pathname.startsWith(`${base}/`))
      return null;
    const path = (base ? url.pathname.slice(base.length) : url.pathname) || "/";
    if (
      isPersonFormPage(path) ||
      path === "/jobs/new" ||
      !/^(?:\/(?:people|works)(?:\/[^/]+)?\/?|\/jobs\/?|\/)$/.test(path)
    )
      return null;
    for (const key of [...url.searchParams.keys()])
      if (key.startsWith("_")) url.searchParams.delete(key);
    return `${path}${url.search}`;
  } catch {
    return null;
  }
}

export function jobDetailUrl(jobId: string, origin: string, base = "") {
  const back = originPath(origin, base) ?? "/jobs";
  return `/jobs/${encodeURIComponent(jobId)}?${new URLSearchParams({ back: `${base}${back}` })}`;
}

export function jobReturn(
  back: string | null | undefined,
  base = "",
  fallback = "/jobs",
) {
  return (
    originPath(back, base) ?? originPath(`${base}${fallback}`, base) ?? "/jobs"
  );
}

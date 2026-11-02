export function loginTarget(from: unknown) {
  if (
    typeof from !== "string" ||
    !from.startsWith("/") ||
    from.startsWith("//") ||
    /[\\\x00-\x1f]/.test(from)
  )
    return "/";
  try {
    const url = new URL(from, "https://bari.invalid");
    const path = decodeURIComponent(url.pathname);
    if (
      url.origin !== "https://bari.invalid" ||
      /^\/(?:login|register|auth\/confirm)(?:\/|$)/i.test(path)
    )
      return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

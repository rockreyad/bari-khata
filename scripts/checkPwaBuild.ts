export function checkPwaBuild(
  html: string,
  worker: string,
  manifest: unknown,
  expected: { latestVersion: string; minimumSupportedVersion: string },
) {
  const documents = [
    ...html.matchAll(
      /<meta\s+name="bari-build"\s+content="([a-f0-9]{16})"\s*\/?\s*>/g,
    ),
  ];
  const workerBuild = worker.match(/const BUILD = "([a-f0-9]{16})";/)?.[1];
  if (documents.length !== 1 || !workerBuild || documents[0][1] !== workerBuild)
    throw new Error(
      "The emitted HTML and service worker must have one matching build ID.",
    );
  const assetSource = worker.match(/const ASSETS = (\[[^\n]+\]);/)?.[1];
  const assets: unknown = assetSource ? JSON.parse(assetSource) : null;
  if (
    !Array.isArray(assets) ||
    !assets.includes("/index.html") ||
    assets.includes("/release.json")
  )
    throw new Error(
      "The offline shell must cache index.html and exclude release.json.",
    );
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("latestVersion" in manifest) ||
    manifest.latestVersion !== expected.latestVersion ||
    !("minimumSupportedVersion" in manifest) ||
    manifest.minimumSupportedVersion !== expected.minimumSupportedVersion
  )
    throw new Error(
      "The emitted release manifest must match the package and release policy.",
    );
}

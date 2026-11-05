import type { Account } from "../../domain/model";

export function reportMode(
  params: URLSearchParams,
  initialGroupId = "",
): "cash" | "cost" {
  if (params.get("mode") === "cash") return "cash";
  return initialGroupId ||
    params.get("mode") === "cost" ||
    ["section", "group", "item", "brand", "usage", "type"].some((key) =>
      params.has(key),
    )
    ? "cost"
    : "cash";
}

export function reportCashAccount(
  params: URLSearchParams,
): Account | undefined {
  const account = params.get("account");
  if (account === "materials" || account === "labour" || account === "other")
    return account;

  const section = params.get("section");
  if (section === "material") return "materials";
  if (section === "labour") return "labour";
  if (section === "all" || section === "transport" || section === "other")
    return undefined;

  const costType = params.get("type");
  if (costType === "material") return "materials";
  if (costType === "labour") return "labour";
  return undefined;
}

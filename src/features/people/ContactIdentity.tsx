import {
  HardHatIcon,
  StorefrontIcon,
  TruckIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { personKind } from "../../domain/contacts";
import type { Account, Person } from "../../domain/model";
export const accountLabels: Record<Account, string> = {
  materials: "মালের হিসাব",
  labour: "মজুরির হিসাব",
  other: "আনা ও অন্য খরচ",
};
export const kindLabels = {
  worker: "মিস্ত্রি",
  shop: "দোকান",
  driver: "গাড়িচালক",
  other: "অন্য নাম",
};
export function PersonMark({
  person,
  large = false,
}: {
  person: Person;
  large?: boolean;
}) {
  const kind = personKind(person);
  const Icon =
    kind === "shop"
      ? StorefrontIcon
      : kind === "worker"
        ? HardHatIcon
        : kind === "driver"
          ? TruckIcon
          : UserCircleIcon;
  return (
    <span
      className={`contact-mark contact-${kind} ${large ? "contact-mark-large" : ""}`}
    >
      <Icon size={large ? 32 : 22} weight="duotone" />
    </span>
  );
}

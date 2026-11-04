import type { Person, PersonKind } from "./model.js";

export function personKind(
  person: Pick<Person, "kind" | "name" | "role" | "contactType">,
): PersonKind {
  if (person.kind) return person.kind;
  if (person.contactType) {
    if (person.contactType === "supplier") return "shop";
    if (person.contactType === "transport") return "driver";
    return person.contactType === "custom" ? "other" : "worker";
  }
  const description = `${person.role} ${person.name}`;
  if (
    /দোকান|স্টোর|হার্ডওয়্যার|ট্রেড|সাপ্লাই|এন্টারপ্রাইজ|shop|store|trading|enterprise|supplier|hardware/i.test(
      description,
    )
  )
    return "shop";
  if (/চালক|ড্রাইভার|ভ্যান|driver|transport|truck|van/i.test(description))
    return "driver";
  if (
    /মিস্ত্রি|মিস্রি|মিস্তিরি|শ্রমিক|ঠিকাদার|লেবার|contractor|worker|electrician|plumber|mistri/i.test(
      description,
    )
  )
    return "worker";
  return "other";
}

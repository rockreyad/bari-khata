import { z } from "zod";

const RawContactSchema = z.object({
  name: z.array(z.string().max(200)).max(10).optional(),
  tel: z.array(z.string().max(100)).max(30).optional(),
});
export type ImportedContact = { name: string; phones: string[] };
export const contactFileLimit = 2 * 1024 * 1024;

export function importedContact(value: unknown): ImportedContact {
  const contact = RawContactSchema.parse(value);
  const phones = [
    ...new Set(
      (contact.tel ?? [])
        .map((phone) =>
          phone
            .replace(/^tel:/i, "")
            .replace(/[০-৯]/g, (d) => String("০১২৩৪৫৬৭৮৯".indexOf(d)))
            .replace(/[\s().-]/g, ""),
        )
        .filter((phone) => /^\+?\d{6,20}$/.test(phone)),
    ),
  ];
  if (!phones.length) throw new Error("contact_phone_missing");
  return {
    name: (contact.name?.[0] ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim(),
    phones,
  };
}

function unescapeVcard(value: string) {
  return value.replace(/\\([nN,;\\])/g, (_, char: string) =>
    /n/i.test(char) ? " " : char,
  );
}

export function parseContactCard(text: string): ImportedContact {
  if (text.length > contactFileLimit) throw new Error("contact_file_too_large");
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/);
  const begins = lines.filter(
    (line) => line.trim().toUpperCase() === "BEGIN:VCARD",
  );
  const ends = lines.filter(
    (line) => line.trim().toUpperCase() === "END:VCARD",
  );
  if (begins.length !== 1 || ends.length !== 1)
    throw new Error("contact_single_card_required");
  const first = lines.findIndex(
    (line) => line.trim().toUpperCase() === "BEGIN:VCARD",
  );
  const last = lines.findIndex(
    (line) => line.trim().toUpperCase() === "END:VCARD",
  );
  if (last <= first) throw new Error("contact_invalid_card");
  let name = "";
  let structuredName = "";
  const tel: string[] = [];
  for (const line of lines.slice(first + 1, last)) {
    const divider = line.indexOf(":");
    if (divider < 0) continue;
    const header = line.slice(0, divider);
    const property = header.split(";")[0].split(".").at(-1)?.toUpperCase();
    const value = line.slice(divider + 1).trim();
    if (property === "FN" && !name && !/ENCODING=/i.test(header))
      name = unescapeVcard(value);
    if (property === "N" && !structuredName && !/ENCODING=/i.test(header))
      structuredName = value
        .split(";")
        .map(unescapeVcard)
        .filter(Boolean)
        .join(" ");
    if (property === "TEL") tel.push(value);
  }
  return importedContact({ name: [name || structuredName], tel });
}

export type ContactPicker = {
  select: (
    properties: string[],
    options: { multiple: boolean },
  ) => Promise<unknown[]>;
};
export function deviceContactPicker(): ContactPicker | null {
  if (
    typeof navigator === "undefined" ||
    typeof window === "undefined" ||
    !window.isSecureContext
  )
    return null;
  const picker = (navigator as Navigator & { contacts?: ContactPicker })
    .contacts;
  return picker && typeof picker.select === "function" ? picker : null;
}

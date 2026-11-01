import { describe, expect, it } from "vitest";
import {
  contactFileLimit,
  importedContact,
  parseContactCard,
} from "./contactCard";

describe("selected contact validation", () => {
  it("keeps only selected name and usable unique telephone numbers", () => {
    expect(
      importedContact({
        name: ["শাহ আলম"],
        tel: [
          "+880 (1700) 000-091",
          "+8801700000091",
          "০১৭০০০০০০৯২",
          "not a number",
        ],
        email: ["private@example.com"],
      }),
    ).toEqual({ name: "শাহ আলম", phones: ["+8801700000091", "01700000092"] });
  });
  it("reads an iPhone vCard with UTF-8, folded names and multiple phones", () => {
    expect(
      parseContactCard(
        "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:শাহ\r\n  আলম\r\nitem1.TEL;type=CELL:+880 1700-000091\r\nTEL;TYPE=WORK:01700000092\r\nEMAIL:no-copy@example.com\r\nPHOTO:ignored\r\nEND:VCARD\r\n",
      ),
    ).toEqual({ name: "শাহ আলম", phones: ["+8801700000091", "01700000092"] });
  });
  it("supports vCard 4 telephone URIs and escaped names", () => {
    expect(
      parseContactCard(
        "BEGIN:VCARD\nVERSION:4.0\nFN:Door\\, Shop\nTEL;VALUE=uri:tel:+8801700000091\nEND:VCARD",
      ),
    ).toEqual({ name: "Door, Shop", phones: ["+8801700000091"] });
  });
  it.each([
    "not a card",
    "BEGIN:VCARD\nFN:Only name\nEND:VCARD",
    "BEGIN:VCARD\nTEL:01700000091\nEND:VCARD\nBEGIN:VCARD\nTEL:01700000092\nEND:VCARD",
    "END:VCARD\nTEL:01700000091\nBEGIN:VCARD",
    "x".repeat(contactFileLimit + 1),
  ])("rejects invalid, bulk, phone-free or oversized cards", (text) => {
    expect(() => parseContactCard(text)).toThrow();
  });
});

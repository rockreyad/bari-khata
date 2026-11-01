import { localizedDigits } from "../../lib/numerals";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AddressBookIcon, FileArrowUpIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  contactFileLimit,
  deviceContactPicker,
  importedContact,
  parseContactCard,
  type ImportedContact,
} from "./contactCard";
import "./contact-import.css";

export function ContactImport({
  onPick,
}: {
  onPick: (contact: { name: string; phone: string }) => void;
}) {
  const { t, language } = useLanguageContext();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<ImportedContact | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function pick(contact: ImportedContact, phone: string) {
    onPick({ name: contact.name, phone });
    setPending(null);
    setNotice(t("কন্টাক্টের নম্বর আনা হয়েছে। দেখে রাখুন।"));
  }
  function receive(contact: ImportedContact) {
    if (!mounted.current) return;
    if (contact.phones.length === 1) pick(contact, contact.phones[0]);
    else setPending(contact);
  }
  async function fromDevice() {
    const picker = deviceContactPicker();
    setError("");
    setNotice("");
    setPending(null);
    if (!picker) {
      setExpanded((value) => !value);
      return;
    }
    setBusy(true);
    try {
      const contacts = await picker.select(["name", "tel"], {
        multiple: false,
      });
      if (contacts.length === 1) receive(importedContact(contacts[0]));
      else if (contacts.length > 1)
        throw new Error("contact_single_card_required");
    } catch (cause) {
      if (
        mounted.current &&
        !(cause instanceof DOMException && cause.name === "AbortError")
      )
        setError(t("কন্টাক্টের নম্বর আনা যায়নি। আবার বাছুন বা নম্বর লিখুন।"));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function fromFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setNotice("");
    setPending(null);
    setBusy(true);
    try {
      if (file.size > contactFileLimit)
        throw new Error("contact_file_too_large");
      receive(parseContactCard(await file.text()));
    } catch {
      if (mounted.current)
        setError(
          t(
            "একজনের কন্টাক্ট ফাইল (.vcf) দিন, যেখানে ফোন নম্বর আছে। ফাইল ২ মেগাবাইটের মধ্যে রাখুন।",
          ),
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="contact-import">
      <button
        type="button"
        className="contact-import-trigger"
        disabled={busy}
        aria-expanded={deviceContactPicker() ? undefined : expanded}
        onClick={() => void fromDevice()}
      >
        <AddressBookIcon size={18} weight="duotone" />
        {t(busy ? "আনছি…" : "কন্টাক্ট থেকে নিন")}
      </button>
      {expanded ? (
        <div className="contact-import-help">
          <p>
            {t(
              "এই ফোনে সরাসরি কন্টাক্ট বাছাই করা যায় না। কন্টাক্টের নম্বর কপি করে লিখুন, অথবা একজনের কন্টাক্ট ফাইল আনুন।",
            )}
          </p>
          <p>
            {t(
              "iPhone-এ Contacts থেকে Share Contact চাপুন, Save to Files দিয়ে রাখুন। তারপর নিচের বোতামে ফাইলটি বাছুন।",
            )}
          </p>
          <button
            type="button"
            className="contact-import-file"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <FileArrowUpIcon size={18} />
            {t("কন্টাক্ট ফাইল বাছুন (.vcf)")}
          </button>
        </div>
      ) : null}
      <input
        ref={input}
        className="contact-file-input"
        type="file"
        accept=".vcf,text/vcard,text/x-vcard"
        aria-label={t("কন্টাক্ট ফাইল")}
        tabIndex={-1}
        onChange={(event) => void fromFile(event)}
      />
      {pending ? (
        <div className="contact-number-choices">
          <p>{t("কোন নম্বরটি রাখবেন?")}</p>
          {pending.phones.map((phone) => (
            <button
              type="button"
              key={localizedDigits(phone, language)}
              onClick={() => pick(pending, phone)}
            >
              {localizedDigits(phone, language)}
            </button>
          ))}
          <button
            type="button"
            className="contact-import-cancel"
            onClick={() => setPending(null)}
          >
            {t("বাতিল")}
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="field-hint" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

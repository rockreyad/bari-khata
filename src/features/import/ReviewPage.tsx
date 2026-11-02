import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import {
  CheckCircleIcon,
  FileTextIcon,
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  PencilSimpleLineIcon,
  ReceiptIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { EntryList } from "../../components/ui/EntryList";
import { LoadMore } from "../../components/ui/LoadMore";
import { AppSelect } from "../../components/ui/AppSelect";
import { FormError, useFormError } from "../../components/ui/FormError";
import { Sheet } from "../../components/Sheet";
import { useLanguageContext } from "../../context/LanguageProvider";
import { entryTotal } from "../../domain/ledger";
import type { CostType, Entry } from "../../domain/model";
import { organizeHistoricalEntry, reviewDraft, type LineDraft } from "./review";
import { costNames } from "../../lib/display";
import "./review.css";
import "../history/history-v4.css";
import { BulkReviewSheet } from "./BulkReviewSheet";
import { reviewableEntries } from "./bulkReview";

function OrganizeSheet({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  const notebook = useNotebook();
  const { ledger } = notebook;
  const { t, money, date, number, formatDigits } = useLanguageContext();
  const [drafts, setDrafts] = useState(() => reviewDraft(entry, ledger));
  const [saving, setSaving] = useState(false);
  const [, setError, errorNotice] = useFormError();
  const change = (id: string, values: Partial<LineDraft>) =>
    setDrafts((previous) =>
      previous.map((line) => (line.id === id ? { ...line, ...values } : line)),
    );
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await notebook.save((current) =>
        organizeHistoricalEntry(current, entry, drafts),
      );
      onClose();
    } catch {
      setError(t("এখন রাখা যায়নি। লেখা আছে; আবার চেষ্টা করুন।"));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet
      title={t("পুরোনো তথ্য ঠিক করি")}
      subtitle={t("মালের নাম ও খরচের ধরন ঠিক করে রাখুন।")}
      onClose={onClose}
      footer={
        <button
          className="primary-button"
          type="submit"
          form="organize-history"
          disabled={saving}
        >
          <CheckCircleIcon size={20} weight="bold" />
          {t(saving ? "রাখছি…" : "তথ্য রাখুন")}
        </button>
      }
    >
      <form id="organize-history" className="review-form" onSubmit={save}>
        <FormError {...errorNotice} />
        <div className="review-source-card">
          <div>
            <FileTextIcon size={23} weight="duotone" />
            <strong>{t("মূল খাতায় যা লেখা ছিল")}</strong>
          </div>
          <p className="review-original-note">
            {formatDigits(entry.source?.note || t("বিবরণ লেখা নেই"))}
          </p>
          <strong className="review-original-money">
            {money(
              entryTotal(entry) * (entry.kind === "expense_credit" ? -1 : 1),
            )}
          </strong>
          <dl>
            <div>
              <dt>{t("মূল খাতা")}</dt>
              <dd>{formatDigits(entry.source?.ledger ?? "")}</dd>
            </div>
            <div>
              <dt>{t("মূল ঘর")}</dt>
              <dd>{formatDigits(entry.source?.cell ?? "")}</dd>
            </div>
            <div>
              <dt>{t("তারিখ")}</dt>
              <dd>{date(entry.date)}</dd>
            </div>
          </dl>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              onClose();
              notebook.detail(entry.id);
            }}
          >
            {t("পুরো হিসাব দেখুন")}
          </button>
        </div>
        <p className="review-safety-note">
          {t("এখানে শুধু মালের নাম ও ধরন ঠিক হবে। টাকার হিসাব বদলাবে না।")}
        </p>
        {drafts.map((draft, index) => (
          <fieldset className="review-line-fields" key={draft.id}>
            <legend>
              {t("খরচের বিবরণ {{number}}", { number: number(index + 1) })}
            </legend>
            <label>
              {t("কাজের খাতা")}
              <AppSelect
                value={draft.workId}
                required
                onChange={(event) =>
                  change(draft.id, { workId: event.target.value })
                }
              >
                {ledger.works.map((work) => (
                  <option value={work.id} key={work.id}>
                    {work.name}
                  </option>
                ))}
              </AppSelect>
            </label>
            <div className="review-field-pair">
              <label>
                {t("খরচের ধরন")}
                <AppSelect
                  value={draft.costType}
                  onChange={(event) =>
                    change(draft.id, {
                      costType: event.target.value as CostType,
                    })
                  }
                >
                  {Object.entries(costNames).map(([key, label]) => (
                    <option value={key} key={key}>
                      {t(label)}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label>
                {t("মালের ধরন")}
                <AppSelect
                  value={draft.groupId}
                  onChange={(event) =>
                    change(draft.id, {
                      groupId: event.target.value,
                      itemId: "",
                      brand: "",
                      usage: "",
                    })
                  }
                >
                  <option value="">{t("এখনও নিশ্চিত নই")}</option>
                  {ledger.materialGroups.map((group) => (
                    <option value={group.id} key={group.id}>
                      {group.name}
                    </option>
                  ))}
                </AppSelect>
              </label>
            </div>
            <label>
              {t("মালের নাম")}
              <AppSelect
                value={draft.itemId}
                disabled={!draft.groupId}
                onChange={(event) => {
                  const item = ledger.items.find(
                    (value) => value.id === event.target.value,
                  );
                  change(draft.id, {
                    itemId: event.target.value,
                    brand: item?.brand || "",
                    usage: item?.usage || "",
                  });
                }}
              >
                <option value="">{t("নির্দিষ্ট মাল বাছিনি")}</option>
                {ledger.items
                  .filter((item) => item.materialGroupId === draft.groupId)
                  .map((item) => (
                    <option value={item.id} key={item.id}>
                      {item.name}
                    </option>
                  ))}
              </AppSelect>
            </label>
            <div className="review-field-pair">
              <label>
                {t("ব্র্যান্ড")}
                <input
                  value={draft.brand}
                  maxLength={200}
                  disabled={!draft.groupId}
                  placeholder={t("জানা থাকলে লিখুন")}
                  onChange={(event) =>
                    change(draft.id, { brand: event.target.value })
                  }
                />
              </label>
              <label>
                {t("কোন কাজে ব্যবহার")}
                <input
                  value={draft.usage}
                  maxLength={200}
                  placeholder={t("যেমন: প্লাস্টার, ভরাট")}
                  onChange={(event) =>
                    change(draft.id, { usage: event.target.value })
                  }
                />
              </label>
            </div>
          </fieldset>
        ))}
        {entry.reviewReason ? (
          <details className="review-reason">
            <summary>{t("কোন তথ্য দেওয়া বাকি")}</summary>
            <p>{formatDigits(entry.reviewReason)}</p>
          </details>
        ) : null}
      </form>
    </Sheet>
  );
}

export function ReviewPage() {
  const notebook = useNotebook();
  const { ledger } = notebook;
  const { t, money, number } = useLanguageContext();
  const [status, setStatus] = useState("pending");
  const [source, setSource] = useState("");
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const setQuery = (value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value) next.set("q", value);
        else next.delete("q");
        return next;
      },
      { replace: true },
    );
  const scope = JSON.stringify([status, source, query]);
  const [loadedWindow, setLoadedWindow] = useState({ scope, count: 30 });
  const [bulk, setBulk] = useState(() => params.get("bulk") === "1");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  if (loadedWindow.scope !== scope) {
    setLoadedWindow({ scope, count: 30 });
    setChecked(new Set());
  }
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const historical = useMemo(() => reviewableEntries(ledger), [ledger]);
  const pending = historical.filter(
    (entry) => entry.reviewStatus === "needs_review",
  );
  const sources = [...new Set(historical.map((entry) => entry.source!.ledger))];
  const total = historical.reduce(
    (sum, entry) =>
      sum + entryTotal(entry) * (entry.kind === "expense_credit" ? -1 : 1),
    0,
  );
  const filtered = historical.filter(
    (entry) =>
      (status === "all" ||
        (status === "pending"
          ? entry.reviewStatus === "needs_review"
          : entry.reviewStatus === "confirmed")) &&
      (!source || entry.source?.ledger === source) &&
      [
        entry.note,
        entry.source?.ledger,
        entry.source?.cell,
        ...entry.lines.map((line) => line.label),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase().trim()),
  );
  const visible = filtered.slice(
    0,
    loadedWindow.scope === scope ? loadedWindow.count : 30,
  );
  const visibleSelectedCount = visible.filter((entry) =>
    checked.has(entry.id),
  ).length;
  const allVisibleSelected =
    visible.length > 0 &&
    (visibleSelectedCount === visible.length || visibleSelectedCount === 100);
  const selectedEntries = historical.filter((entry) => checked.has(entry.id));
  const toggle = (id: string) =>
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < 100) next.add(id);
      return next;
    });
  const selectedEntry = ledger.entries.find((entry) => entry.id === selected);
  return (
    <div className="review-page">
      <header className="review-page-heading">
        <div className="review-heading-icon">
          <FileTextIcon size={28} weight="duotone" />
        </div>
        <div>
          <p>{t("তথ্য ঠিক করি")}</p>
          <h1>{t("পুরোনো তথ্য ঠিক করি")}</h1>
        </div>
      </header>
      <section className="review-summary">
        <div>
          <span>{t("পুরোনো খাতায় লেখা খরচ")}</span>
          <strong>{money(total)}</strong>
          <p>{t("আগের খাতার প্রতিটি টাকার ঘর একবার করে রাখা হয়েছে।")}</p>
        </div>
        <div className="review-progress">
          <span>
            <PencilSimpleLineIcon size={19} />
            {t("তথ্য যোগ করা বাকি")}
          </span>
          <strong>{number(pending.length)}</strong>
          <small>
            {t("মোট {{count}}টি হিসাব", { count: number(historical.length) })}
          </small>
        </div>
      </section>
      <div className="review-information">
        <ReceiptIcon size={24} weight="duotone" />
        <p>
          {t(
            "পুরোনো খাতায় বিল আর টাকা দেওয়ার হিসাব সব জায়গায় আলাদা ছিল না। তাই এই টাকাগুলো দিয়ে কারও বর্তমান বাকি বা অগ্রিম দেখানো হয়নি।",
          )}
        </p>
      </div>
      <div className="review-toolbar">
        <div className="review-tabs" aria-label={t("হিসাব বাছাই")}>
          {[
            ["pending", "তথ্য যোগ করা বাকি"],
            ["organized", "তথ্য দেওয়া আছে"],
            ["all", "সব হিসাব"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={status === value}
              className={status === value ? "active" : ""}
              onClick={() => {
                setStatus(value);
                setChecked(new Set());
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <div className="review-filter-row">
          <label className="review-search">
            <MagnifyingGlassIcon size={19} />
            <input
              value={query}
              placeholder={t("নোট বা মূল ঘর দিয়ে খুঁজুন")}
              aria-label={t("নোট বা মূল ঘর দিয়ে খুঁজুন")}
              onChange={(event) => {
                setQuery(event.target.value);
                setChecked(new Set());
              }}
            />
            {query ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setChecked(new Set());
                }}
                aria-label={t("খোঁজা মুছুন")}
              >
                <XIcon size={17} />
              </button>
            ) : null}
          </label>
          <label className="review-source-filter">
            <FunnelSimpleIcon size={18} />
            <AppSelect
              value={source}
              aria-label={t("মূল খাতা")}
              onChange={(event) => {
                setSource(event.target.value);
                setChecked(new Set());
              }}
            >
              <option value="">{t("সব মূল খাতা")}</option>
              {sources.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </AppSelect>
          </label>
        </div>
      </div>
      <section className="review-queue">
        <div className="review-queue-heading">
          <h2>{t("হিসাব খুলে তথ্য ঠিক করুন")}</h2>
          <button
            className="text-button"
            onClick={() => {
              setBulk(!bulk);
              setChecked(new Set());
            }}
          >
            {t(bulk ? "বাছাই বন্ধ করি" : "একসঙ্গে ঠিক করি")}
          </button>
        </div>
        {bulk && filtered.length ? (
          <div className="review-bulk-toolbar">
            <label className="review-bulk-all">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                aria-checked={
                  allVisibleSelected
                    ? true
                    : visibleSelectedCount > 0
                      ? "mixed"
                      : false
                }
                ref={(input) => {
                  if (input)
                    input.indeterminate =
                      !allVisibleSelected && visibleSelectedCount > 0;
                }}
                onChange={(event) =>
                  setChecked((previous) => {
                    const next = new Set(previous);
                    visible.forEach((entry) => {
                      if (event.target.checked && next.size < 100)
                        next.add(entry.id);
                      else if (!event.target.checked) next.delete(entry.id);
                    });
                    return next;
                  })
                }
              />
              <span>{t("দেখানো সব বাছি")}</span>
            </label>
            <button
              className="primary-button"
              disabled={!selectedEntries.length}
              onClick={() => setBulkOpen(true)}
            >
              {t("{{count}}টির তথ্য ঠিক করি", {
                count: number(selectedEntries.length),
              })}
            </button>
          </div>
        ) : null}
        {bulk ? (
          <p className="review-bulk-help">
            {t("একবারে সর্বোচ্চ ১০০টি হিসাব বাছতে পারবেন।")}
          </p>
        ) : null}
        {filtered.length ? (
          bulk ? (
            <div>
              {visible.map((entry) => (
                <div className="review-bulk-choice" key={entry.id}>
                  <label>
                    <input
                      type="checkbox"
                      aria-label={t("বাছুন: {{name}}", {
                        name: entry.lines[0]?.label || entry.note,
                      })}
                      checked={checked.has(entry.id)}
                      onChange={() => toggle(entry.id)}
                    />
                  </label>
                  <EntryList
                    ledger={ledger}
                    entries={[entry]}
                    onEntry={setSelected}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EntryList
              ledger={ledger}
              entries={visible}
              onEntry={setSelected}
            />
          )
        ) : (
          <div className="review-empty">
            <CheckCircleIcon size={42} weight="duotone" />
            <h3>
              {t(
                !historical.length
                  ? "এখনও পুরোনো হিসাব নেই"
                  : status === "pending" && !source && !query
                    ? "সব পুরোনো তথ্য দেখা হয়েছে"
                    : "এই বাছাইয়ে হিসাব পাওয়া যায়নি",
              )}
            </h3>
            <p>{t("মূল খাতার তথ্য প্রতিটি হিসাবের সঙ্গে আছে।")}</p>
          </div>
        )}
        <LoadMore
          hasMore={visible.length < filtered.length}
          onLoadMore={() =>
            setLoadedWindow({ scope, count: visible.length + 30 })
          }
        />
      </section>
      {bulkOpen ? (
        <BulkReviewSheet
          entries={selectedEntries}
          onClose={() => setBulkOpen(false)}
          onSaved={() => {
            setBulkOpen(false);
            setChecked(new Set());
          }}
        />
      ) : null}
      {selectedEntry ? (
        <OrganizeSheet
          key={selectedEntry.id}
          entry={selectedEntry}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

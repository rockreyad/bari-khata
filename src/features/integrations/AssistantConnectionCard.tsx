import { RobotIcon } from "@phosphor-icons/react";
import { useLanguageContext } from "../../context/LanguageProvider";
import {
  scopeLabels,
  type AssistantConnection,
  type AssistantScope,
} from "./mcpClient";

export function AssistantConnectionCard({
  connection,
  busy,
  onRevoke,
}: {
  connection: AssistantConnection;
  busy: boolean;
  onRevoke?: () => void;
}) {
  const { t, date, money, formatDigits } = useLanguageContext();
  const revoked = Boolean(connection.revokedAt);
  const expired = Boolean(
    connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now(),
  );
  const timestamp = (value: string | null | undefined, fallback: string) =>
    value ? (
      <time dateTime={value}>
        {date(value, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </time>
    ) : (
      <span>{t(fallback)}</span>
    );

  return (
    <li className="assistant-connection-card">
      <div className="assistant-connection-body">
        <div className="assistant-connection-title">
          <span className="assistant-connection-symbol" aria-hidden="true">
            <RobotIcon size={23} weight="duotone" />
          </span>
          <div>
            <strong>{formatDigits(connection.name)}</strong>
            <code className="assistant-fingerprint">
              {connection.id.slice(0, 8)}
            </code>
          </div>
          <span
            className={`assistant-badge ${revoked || expired ? "is-inactive" : "is-active"}`}
          >
            {t(revoked ? "অনুমতি বন্ধ" : expired ? "মেয়াদ শেষ" : "অনুমতি চালু")}
          </span>
        </div>
        <p className="assistant-policy-summary">
          {connection.policy.confirmationRequired
            ? t("প্রতিবার আপনার অনুমোদন লাগে")
            : t("অনুমতি দেওয়া কাজ সরাসরি করতে পারে")}
          {connection.policy.maxAmountPaisa
            ? ` · ${t("একবারে {{amount}} পর্যন্ত", { amount: money(connection.policy.maxAmountPaisa) })}`
            : ""}
        </p>
        <dl className="assistant-connection-dates">
          <div>
            <dt>{t("অনুমতি দেওয়ার সময়")}</dt>
            <dd>{timestamp(connection.createdAt, "তারিখ পাওয়া যায়নি")}</dd>
          </div>
          <div>
            <dt>{t("সর্বশেষ ব্যবহার")}</dt>
            <dd>
              {timestamp(
                connection.lastUsedAt,
                "ব্যবহারের সময় এখনও রেকর্ড হয়নি",
              )}
            </dd>
          </div>
          {connection.expiresAt ? (
            <div>
              <dt>{t("মেয়াদ শেষ হবে")}</dt>
              <dd>{timestamp(connection.expiresAt, "তারিখ পাওয়া যায়নি")}</dd>
            </div>
          ) : null}
          {connection.revokedAt ? (
            <div>
              <dt>{t("অনুমতি বন্ধের সময়")}</dt>
              <dd>{timestamp(connection.revokedAt, "তারিখ পাওয়া যায়নি")}</dd>
            </div>
          ) : null}
        </dl>
        <div className="assistant-connection-footer">
          <details className="assistant-connection-details">
            <summary>{t("অনুমতি ও বিস্তারিত")}</summary>
            <div className="assistant-connection-id">
              <span>{t("সংযোগের পরিচয়")}</span>
              <code>{connection.id}</code>
            </div>
            <ul className="assistant-scope-list">
              {connection.scopes.map((scope) => (
                <li key={scope}>
                  <span>
                    {t(scopeLabels[scope as AssistantScope] ?? scope)}
                  </span>
                  <code>{scope}</code>
                </li>
              ))}
            </ul>
          </details>
          {onRevoke ? (
            <button
              type="button"
              className="assistant-revoke"
              disabled={busy}
              onClick={onRevoke}
            >
              {t("অনুমতি বন্ধ করুন")}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

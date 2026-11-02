import { useLanguageContext } from "../../context/LanguageProvider";
import { MoneyInput } from "../../components/ui/MoneyInput";
import { assistantScopes, scopeLabels, type AssistantScope } from "./mcpClient";

export function AssistantPermissions({
  scopes,
  onScopesChange,
  confirmationRequired,
  onConfirmationChange,
  maximum,
  onMaximumChange,
  allowed = assistantScopes,
  disabled = false,
}: {
  scopes: AssistantScope[];
  onScopesChange: (scopes: AssistantScope[]) => void;
  confirmationRequired: boolean;
  onConfirmationChange: (required: boolean) => void;
  maximum: string;
  onMaximumChange: (value: string) => void;
  allowed?: readonly AssistantScope[];
  disabled?: boolean;
}) {
  const { t } = useLanguageContext();
  const canWrite = scopes.some(
    (scope) => scope !== "ledger:read" && scope !== "receipts:read",
  );
  return (
    <div className="assistant-permissions">
      <fieldset disabled={disabled}>
        <legend>{t("কী করতে পারবে")}</legend>
        <div className="assistant-scope-grid">
          {allowed.map((scope) => (
            <label className="assistant-check" key={scope}>
              <input
                type="checkbox"
                disabled={scope === "ledger:read"}
                checked={scopes.includes(scope)}
                onChange={(event) =>
                  onScopesChange(
                    event.target.checked
                      ? [...scopes, scope]
                      : scopes.filter((item) => item !== scope),
                  )
                }
              />
              <span>{t(scopeLabels[scope])}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {canWrite ? (
        <>
          <label className="assistant-check assistant-policy">
            <input
              type="checkbox"
              checked={confirmationRequired}
              disabled={disabled}
              onChange={(event) => onConfirmationChange(event.target.checked)}
            />
            <span>{t("হিসাব রাখার আগে প্রতিবার আমাকে দেখাবে")}</span>
          </label>
          <label className="assistant-field">
            <span>{t("একবারে সর্বোচ্চ টাকা")}</span>
            <MoneyInput
              aria-label={t("একবারে সর্বোচ্চ টাকা")}
              value={maximum}
              disabled={disabled}
              onChange={(event) => onMaximumChange(event.target.value)}
              placeholder={t("সীমা না চাইলে খালি রাখুন")}
            />
          </label>
          <p className="assistant-muted">
            {t(
              confirmationRequired
                ? "এখানে প্রস্তাব মেনে নিলে সহকারী সেটি খাতায় রাখতে পারবে।"
                : "বেছে দেওয়া কাজ সহকারী সরাসরি করতে পারবে। সীমার বাইরে গেলে আগে আপনাকে দেখাবে।",
            )}
          </p>
        </>
      ) : null}
    </div>
  );
}

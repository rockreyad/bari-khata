import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  CodeIcon,
  CopyIcon,
  KeyIcon,
  RobotIcon,
  ShieldCheckIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useNotebook } from "../../app/NotebookProvider";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog";
import { FormError, useFormError } from "../../components/ui/FormError";
import { useLanguageContext } from "../../context/LanguageProvider";
import { getActiveOwner } from "../../data/database";
import { parseMoneyText } from "../../domain/money";
import { useAuth } from "../auth/AuthProvider";
import { AssistantPermissions } from "./AssistantPermissions";
import { AssistantConnectionCard } from "./AssistantConnectionCard";
import { AssistantProposalDetails } from "./AssistantProposalDetails";
import {
  approveAssistantProposal,
  assistantConfiguration,
  assistantErrors,
  assistantInstallCommand,
  assistantScopes,
  createAssistantConnection,
  canReviewProposal,
  dailyScopes,
  loadAssistantConnections,
  loadAssistantProposals,
  revokeAssistantConnection,
  type AssistantConnection,
  type AssistantProposal,
  type AssistantScope,
} from "./mcpClient";
import "./integrations.css";

export function AssistantSettingsPage() {
  const { mode, go, ledger } = useNotebook();
  const auth = useAuth();
  const { t, number } = useLanguageContext();
  const owner = auth.user?.id ?? null;
  const [loaded, setLoaded] = useState<{
    owner: string;
    connections: AssistantConnection[];
    proposals: AssistantProposal[];
    endpoint: string;
    available: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError, errorNotice] = useFormError();
  const [message, setMessage] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<AssistantScope[]>(dailyScopes);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [maximum, setMaximum] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{
    owner: string;
    token: string;
    endpoint: string;
  } | null>(null);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [revoking, setRevoking] = useState<AssistantConnection | null>(null);
  const mounted = useRef(false);
  const actionLock = useRef(false);
  const data = loaded?.owner === owner && mode === "real" ? loaded : null;
  const currentSecret =
    secret?.owner === owner && mode === "real" ? secret : null;
  const enabled =
    mode === "real" && auth.status === "signed-in" && Boolean(owner);
  const active = () => mounted.current && enabled && getActiveOwner() === owner;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setSecret(null);
    setSecretRevealed(false);
    setCreating(false);
    setRevoking(null);
    setName("");
    setScopes(dailyScopes);
    setMaximum("");
    setConfirmationRequired(false);
    setMessage("");
    setError("");
  }, [owner, mode]);
  useEffect(() => {
    if (!enabled || !owner) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void Promise.all([
      loadAssistantConnections(owner, controller.signal),
      loadAssistantProposals(owner, controller.signal),
    ])
      .then(([connections, proposals]) => {
        if (!controller.signal.aborted && getActiveOwner() === owner) {
          setLoaded({
            owner,
            connections: connections.connections,
            proposals: proposals.proposals,
            endpoint: connections.endpoint ?? "",
            available: connections.available,
          });
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && getActiveOwner() === owner)
          setError(
            assistantErrors[cause instanceof Error ? cause.message : ""] ??
              "সহকারীর সংযোগ এখন পাওয়া যাচ্ছে না। একটু পরে চেষ্টা করুন।",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, owner, reload]);

  async function action(callback: () => Promise<void>) {
    if (actionLock.current || !active()) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await callback();
    } catch (cause) {
      if (active())
        setError(
          assistantErrors[cause instanceof Error ? cause.message : ""] ??
            "কাজটি পুরো শেষ হয়নি। আবার চেষ্টা করুন।",
        );
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current) setMessage("কপি হয়েছে");
    } catch {
      if (mounted.current)
        setError("কপি করা যায়নি। লেখাটি বেছে নিয়ে কপি করুন।");
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      if (!owner || !name.trim() || !scopes.length) return;
      let maxAmountPaisa: number | null = null;
      if (maximum.trim()) {
        try {
          maxAmountPaisa = parseMoneyText(maximum);
          if (maxAmountPaisa <= 0) throw new Error();
        } catch {
          throw new Error("invalid_amount");
        }
      }
      const result = await createAssistantConnection(owner, {
        name: name.trim(),
        scopes,
        policy: { confirmationRequired, maxAmountPaisa },
      });
      if (!active()) return;
      setSecret({ owner, token: result.token, endpoint: result.endpoint });
      setSecretRevealed(false);
      setLoaded((previous) =>
        previous?.owner === owner
          ? {
              ...previous,
              connections: [result.connection, ...previous.connections],
              endpoint: result.endpoint,
            }
          : previous,
      );
      setName("");
      setCreating(false);
    });
  }
  const endpoint = data?.endpoint ?? "";
  const endpointUrl = endpoint ? new URL(endpoint) : null;
  const claudeNeedsPublishedAddress = Boolean(
    endpointUrl &&
    (endpointUrl.protocol !== "https:" ||
      endpointUrl.hostname === "localhost" ||
      endpointUrl.hostname.endsWith(".localhost") ||
      /^127\./.test(endpointUrl.hostname) ||
      endpointUrl.hostname === "[::1]"),
  );
  const connections =
    data?.connections.filter((connection) => !connection.revokedAt) ?? [];
  const revokedConnections =
    data?.connections.filter((connection) => connection.revokedAt) ?? [];
  const proposals =
    data?.proposals.filter((proposal) =>
      ["pending", "awaiting_approval", "prepared", "approved"].includes(
        proposal.status,
      ),
    ) ?? [];
  return (
    <div className="assistant-page page-content">
      <button
        type="button"
        className="assistant-back"
        onClick={() => go("/settings")}
      >
        <ArrowLeftIcon size={19} />
        {t("সেটিংসে ফিরুন")}
      </button>
      <header className="page-heading assistant-page-heading">
        <div>
          <span className="assistant-eyebrow">{t("AI agent · MCP")}</span>
          <h1>{t("আপনার AI সহকারী")}</h1>
          <p>{t("Codex, Claude বা নিজের agent-কে খাতার সঙ্গে যুক্ত করুন।")}</p>
        </div>
        <RobotIcon
          className="assistant-heading-icon"
          size={34}
          weight="duotone"
          aria-hidden="true"
        />
      </header>
      {mode === "demo" ? (
        <section className="assistant-card assistant-notice">
          <ShieldCheckIcon size={25} />
          <div>
            <h2>{t("নমুনায় সংযোগ দেওয়া যায় না")}</h2>
            <p>
              {t(
                "নিজের খাতায় ঢুকে সহকারী যোগ করুন। নমুনার হিসাব ব্যক্তিগত সহকারীর কাছে পাঠানো হয় না।",
              )}
            </p>
            <button type="button" className="primary-button" disabled>
              {t("সহকারী যোগ করুন")}
            </button>
          </div>
        </section>
      ) : !enabled ? (
        <section className="assistant-card">
          <p>
            {t(
              "সংযোগ দিতে বা অনুমতি বদলাতে ইন্টারনেটে যুক্ত হয়ে নিজের খাতা খুলুন।",
            )}
          </p>
        </section>
      ) : null}
      {!revoking ? (
        <FormError
          {...errorNotice}
          message={t(error)}
          className="assistant-error"
        />
      ) : null}
      {message ? (
        <p className="assistant-success" role="status">
          {t(message)}
        </p>
      ) : null}
      {loading ? <p role="status">{t("সংযোগের তথ্য আনছি…")}</p> : null}
      {enabled && !loading && (!data || !data.available) ? (
        <button
          className="secondary-button"
          type="button"
          onClick={() => setReload((value) => value + 1)}
        >
          {t("আবার চেষ্টা করুন")}
        </button>
      ) : null}
      {enabled && data?.available && endpoint ? (
        <>
          <section className="assistant-card assistant-setup">
            <div className="assistant-section-heading">
              <div>
                <h2>{t("MCP সংযোগ")}</h2>
                <p className="assistant-muted">
                  {t("একটি ঠিকানা। আপনার পছন্দের agent।")}
                </p>
              </div>
              <span className="assistant-setup-symbol" aria-hidden="true">
                <CodeIcon size={27} />
              </span>
            </div>
            <div className="assistant-protocols" aria-label={t("সংযোগের ধরন")}>
              <span>{t("Streamable HTTP")}</span>
              <span>{t("OAuth 2.1")}</span>
              <span>
                {t(
                  claudeNeedsPublishedAddress
                    ? "স্থানীয় ঠিকানা"
                    : "প্রকাশিত ঠিকানা",
                )}
              </span>
            </div>
            <label className="assistant-field">
              <span>{t("সংযোগের ঠিকানা")}</span>
              <span className="assistant-copy-field">
                <input
                  readOnly
                  aria-label={t("সংযোগের ঠিকানা")}
                  value={endpoint}
                  spellCheck={false}
                  onFocus={(event) => event.target.select()}
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void copy(endpoint)}
                  aria-label={t("ঠিকানা কপি করুন")}
                >
                  <CopyIcon size={18} />
                  <span className="assistant-copy-label">{t("কপি করুন")}</span>
                </button>
              </span>
            </label>
            <details
              className="assistant-details assistant-client-help assistant-codex-help"
              open
            >
              <summary>{t("Codex-এ যোগ করুন")}</summary>
              <p className="assistant-muted">
                {t("টার্মিনালে চালান। ব্রাউজার খুললে লগইন করে অনুমতি দিন।")}
              </p>
              <div className="assistant-command">
                <div className="assistant-command-heading">
                  <span>{t("টার্মিনাল")}</span>
                  <button
                    className="assistant-command-copy"
                    type="button"
                    onClick={() => void copy(assistantInstallCommand(endpoint))}
                  >
                    <CopyIcon size={16} aria-hidden="true" />
                    {t("কমান্ড কপি করুন")}
                  </button>
                </div>
                <pre tabIndex={0} aria-label={t("Codex সেটআপ কমান্ড")}>
                  <code>{assistantInstallCommand(endpoint)}</code>
                </pre>
              </div>
              <p className="assistant-muted">
                {t(
                  "এই কমান্ডেই লগইন শুরু হয়। সঙ্গে আলাদা login কমান্ড চালানোর প্রয়োজন নেই।",
                )}
              </p>
              <details className="assistant-troubleshooting">
                <summary>{t("যাচাই ও আবার লগইন")}</summary>
                <p className="assistant-muted">
                  {t("সংযোগের ঠিকানা ও অবস্থা দেখতে")}
                </p>
                <pre>
                  <code>{"codex mcp get bari-khata"}</code>
                </pre>
                <p className="assistant-muted">
                  {t("আগের সংযোগে আবার লগইন দরকার হলে")}
                </p>
                <pre>
                  <code>{"codex mcp login bari-khata"}</code>
                </pre>
                <p className="assistant-muted">
                  {t(
                    "Agent-কে get_capabilities চালাতে বলুন। এতে অনুমতি যাচাই হবে, খাতার হিসাব বদলাবে না।",
                  )}
                </p>
                <p className="assistant-muted">
                  {t(
                    "শেষে “Authentication complete” দেখালে লগইন শেষ। ওই পাতাটি agent নিজে দেখায়; বন্ধ করে এখানে ফিরতে পারেন।",
                  )}
                </p>
              </details>
            </details>
            <details className="assistant-details assistant-client-help">
              <summary>{t("Claude-এ যোগ করুন")}</summary>
              {claudeNeedsPublishedAddress ? (
                <p className="assistant-muted" role="note">
                  {t(
                    "এটি স্থানীয় ঠিকানা। Claude-এর সংযোগ Anthropic-এর সার্ভার থেকে আসে, তাই প্রকাশিত HTTPS ঠিকানা লাগবে।",
                  )}
                </p>
              ) : null}
              <ol className="assistant-steps">
                <li>
                  {t(
                    "Claude-এ Customize → Connectors খুলে + Add → Add custom connector বেছে নিন।",
                  )}
                </li>
                <li>
                  {t(
                    "নাম হিসেবে বাড়ির খাতা দিন। Remote MCP URL-এ উপরের ঠিকানা বসিয়ে Continue চাপুন।",
                  )}
                </li>
                <li>
                  {t(
                    "Authentication-এ Sign in now এবং OAuth client-এ Register automatically বেছে নিন।",
                  )}
                </li>
                <li>
                  {t(
                    "Add বা Connect চাপলে বাড়ির খাতায় লগইন করে প্রয়োজনীয় অনুমতি দিন।",
                  )}
                </li>
                <li>
                  {t("কথা বলার সময় + → Connectors থেকে বাড়ির খাতা চালু রাখুন।")}
                </li>
              </ol>
              <a
                href="https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp"
                target="_blank"
                rel="noreferrer"
              >
                {t("Claude-এর অফিসিয়াল নির্দেশনা")}
              </a>
            </details>
            <details className="assistant-details assistant-extra">
              <summary>{t("অন্যভাবে সংযোগ দিন")}</summary>
              <p className="assistant-muted">
                {t(
                  "আপনার সহকারীতে গোপন চাবি বসানোর জায়গা থাকলে এই পদ্ধতি ব্যবহার করুন।",
                )}
              </p>
              <button
                type="button"
                className="secondary-button"
                disabled={busy || creating}
                onClick={() => {
                  setSecret(null);
                  setCreating(true);
                  setError("");
                }}
              >
                {t("চাবি দিয়ে যোগ করুন")}
              </button>
              <p className="assistant-muted">
                {t(
                  "সহকারী অনলাইনে পৌঁছানো হিসাব দেখতে পায়। ফোনের না পাঠানো লেখা আগে মিলিয়ে নিন।",
                )}
              </p>
            </details>
          </section>
          {currentSecret ? (
            <section
              className="assistant-card assistant-secret"
              aria-labelledby="assistant-secret-title"
            >
              <div className="assistant-section-heading">
                <h2 id="assistant-secret-title">
                  {t("সংযোগের চাবি তৈরি হয়েছে")}
                </h2>
                <button
                  type="button"
                  className="assistant-icon-button"
                  aria-label={t("চাবি বন্ধ করুন")}
                  onClick={() => setSecret(null)}
                >
                  <XIcon size={20} />
                </button>
              </div>
              <p>
                {t(
                  "এই চাবি এইবারই দেখা যাবে। শুধু নিজের সহকারীর সংযোগে রাখুন। পাতা ছাড়লে এখানে আর পাওয়া যাবে না।",
                )}
              </p>
              <label className="assistant-field">
                <span>{t("গোপন চাবি")}</span>
                <input
                  type={secretRevealed ? "text" : "password"}
                  aria-label={t("গোপন চাবি")}
                  readOnly
                  value={currentSecret.token}
                  spellCheck={false}
                  autoComplete="off"
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <div className="assistant-actions">
                <button
                  type="button"
                  className="secondary-button"
                  aria-pressed={secretRevealed}
                  onClick={() => setSecretRevealed((value) => !value)}
                >
                  {t(secretRevealed ? "চাবি আড়াল করুন" : "চাবি দেখান")}
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void copy(currentSecret.token)}
                >
                  {t("চাবি কপি করুন")}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    void copy(
                      assistantConfiguration(
                        currentSecret.endpoint,
                        currentSecret.token,
                      ),
                    )
                  }
                >
                  {t("সংযোগের JSON কপি করুন")}
                </button>
              </div>
              <details className="assistant-details">
                <summary>{t("সংযোগের পুরো লেখা দেখুন")}</summary>
                <pre>
                  {assistantConfiguration(
                    currentSecret.endpoint,
                    secretRevealed ? currentSecret.token : "••••••••",
                  )}
                </pre>
              </details>
            </section>
          ) : null}
          <section className="assistant-card">
            <div className="assistant-section-heading">
              <div>
                <h2>{t("সংযুক্ত সহকারী")}</h2>
                <p className="assistant-muted">
                  {t("{{count}}টি সংযোগ · সময় বাংলাদেশের", {
                    count: number(connections.length),
                  })}
                </p>
              </div>
              <button
                className="secondary-button assistant-refresh"
                type="button"
                aria-label={t("তথ্য হালনাগাদ করুন")}
                disabled={loading || busy}
                onClick={() => setReload((value) => value + 1)}
              >
                <ArrowsClockwiseIcon size={17} aria-hidden="true" />
                <span>{t("তথ্য হালনাগাদ করুন")}</span>
              </button>
            </div>
            <p className="assistant-muted">
              {t(
                "প্রতিটি অনুমতি আলাদা সংযোগ। একই নাম থাকলে পরিচয় ও অনুমতির সময় মিলিয়ে দেখুন।",
              )}
            </p>
            {connections.length ? (
              <ul className="assistant-connections">
                {connections.map((connection) => (
                  <AssistantConnectionCard
                    key={connection.id}
                    connection={connection}
                    busy={busy}
                    onRevoke={() => setRevoking(connection)}
                  />
                ))}
              </ul>
            ) : (
              <p>{t("এখনও কোনো সহকারী যুক্ত নেই।")}</p>
            )}
            {revokedConnections.length ? (
              <details className="assistant-details">
                <summary>
                  {t("বন্ধ করা সংযোগ ({{count}})", {
                    count: number(revokedConnections.length),
                  })}
                </summary>
                <ul className="assistant-connections">
                  {revokedConnections.map((connection) => (
                    <AssistantConnectionCard
                      key={connection.id}
                      connection={connection}
                      busy={false}
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
          {creating ? (
            <section className="assistant-card">
              <h2>{t("চাবি দিয়ে সহকারী যোগ করুন")}</h2>
              <p className="assistant-muted">
                {t(
                  "আপনার সহকারীতে গোপন চাবি বসানোর জায়গা থাকলে এই পদ্ধতি ব্যবহার করুন।",
                )}
              </p>
              <form onSubmit={(event) => void create(event)}>
                <label className="assistant-field">
                  <span>{t("সহকারীর নাম")}</span>
                  <input
                    value={name}
                    autoFocus
                    maxLength={120}
                    required
                    disabled={busy}
                    placeholder={t("যেমন: আমার সহকারী")}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <div
                  className="assistant-presets"
                  role="group"
                  aria-label={t("সহজে অনুমতি বাছুন")}
                >
                  <button
                    type="button"
                    disabled={busy}
                    className="secondary-button"
                    onClick={() => setScopes(["ledger:read"])}
                  >
                    {t("শুধু দেখা")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="secondary-button"
                    onClick={() => setScopes(dailyScopes)}
                  >
                    {t("দৈনন্দিন হিসাব")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className="secondary-button"
                    onClick={() => setScopes([...assistantScopes])}
                  >
                    {t("সব কাজের অনুমতি")}
                  </button>
                </div>
                <AssistantPermissions
                  scopes={scopes}
                  onScopesChange={setScopes}
                  confirmationRequired={confirmationRequired}
                  onConfirmationChange={setConfirmationRequired}
                  maximum={maximum}
                  onMaximumChange={setMaximum}
                  disabled={busy}
                />
                <div className="assistant-actions">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={busy || !name.trim() || !scopes.length}
                  >
                    <KeyIcon size={18} />
                    {t(busy ? "অপেক্ষা করুন…" : "চাবি তৈরি করুন")}
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={busy}
                    onClick={() => setCreating(false)}
                  >
                    {t("বাদ দিন")}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
          {proposals.length ? (
            <section className="assistant-card">
              <h2>{t("আপনার অনুমোদনের অপেক্ষায়")}</h2>
              <p className="assistant-muted">
                {t(
                  "মেনে নেওয়ার পরে সহকারীকে কাজটি শেষ করতে বলুন। হিসাব রাখা হলে সহকারী জানাবে।",
                )}
              </p>
              <div className="assistant-proposals">
                {proposals.map((proposal) => (
                  <article key={proposal.id}>
                    <AssistantProposalDetails
                      proposal={proposal}
                      ledger={ledger}
                    />
                    {proposal.status === "approved" ? (
                      <p className="assistant-success">
                        {t("আপনি মেনে নিয়েছেন। সহকারীর কাজ শেষ করার অপেক্ষায়।")}
                      </p>
                    ) : (
                      <div className="assistant-actions">
                        <button
                          className="primary-button"
                          type="button"
                          disabled={busy || !canReviewProposal(proposal)}
                          onClick={() =>
                            void action(async () => {
                              await approveAssistantProposal(
                                owner!,
                                proposal.id,
                                true,
                              );
                              if (active()) {
                                setMessage("প্রস্তাবটি মেনে নেওয়া হয়েছে");
                                setReload((value) => value + 1);
                              }
                            })
                          }
                        >
                          {t("মেনে নিই")}
                        </button>
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void action(async () => {
                              await approveAssistantProposal(
                                owner!,
                                proposal.id,
                                false,
                              );
                              if (active()) {
                                setMessage("প্রস্তাবটি বাদ দেওয়া হয়েছে");
                                setReload((value) => value + 1);
                              }
                            })
                          }
                        >
                          {t("প্রস্তাব বাদ দিন")}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      {revoking ? (
        <ConfirmationDialog
          title={t("এই সহকারীর অনুমতি বন্ধ করবেন?")}
          description={t(
            "এরপর এই সংযোগ দিয়ে নতুন হিসাব দেখা বা বদলানো যাবে না। আগের হিসাব থাকবে।",
          )}
          confirmLabel={t("অনুমতি বন্ধ করুন")}
          busy={busy}
          error={error ? t(error) : undefined}
          danger={false}
          onClose={() => setRevoking(null)}
          onConfirm={async () => {
            await action(async () => {
              await revokeAssistantConnection(owner!, revoking.id);
              if (active()) {
                setSecret((previous) => (previous?.token ? null : previous));
                setRevoking(null);
                setMessage("সহকারীর অনুমতি বন্ধ হয়েছে");
                setReload((value) => value + 1);
              }
            });
          }}
        />
      ) : null}
    </div>
  );
}

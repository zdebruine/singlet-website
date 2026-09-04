import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check, Copy, KeyRound, Loader2, Trash2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { CodeBlock } from "@/components/CodeBlock";
import { useAuth } from "@/components/auth/AuthProvider";
import { useUsageToday } from "@/components/auth/AccountMenu";
import { apiClient, isApiError } from "@/integrations/api/client";
import type { ApiKeySummary } from "@/integrations/api/types";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useAiQuota } from "@/lib/ai-quota";
import { fmtInt } from "@/lib/catalog-display";
import { cn } from "@/lib/utils";

const SEARCH_LIMIT = 200;
const EXPLAIN_LIMIT = 100;

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: "Never", days: null },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "1 year", days: 365 },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return fmtDate(iso);
}

function keyState(k: ApiKeySummary): "active" | "revoked" | "expired" {
  if (k.revoked_at) return "revoked";
  if (k.expires_at && Date.parse(k.expires_at) <= Date.now()) return "expired";
  return "active";
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary btn-sm shrink-0"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          window.setTimeout(() => setDone(false), 1800);
        } catch {
          /* clipboard blocked — the text is selectable */
        }
      }}
      aria-label={done ? "Copied" : `${label} to clipboard`}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? "Copied" : label}
    </button>
  );
}

function SignedOut({ openSignIn }: { openSignIn: () => void }) {
  return (
    <div className="surface p-6 max-w-[560px]">
      <h1 className="font-display text-[24px] font-semibold tracking-tight text-foreground">Your account</h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        Sign in to see today's AI usage and to create API keys for scripts and the MCP server. Accounts are free, and browsing and
        downloading never need one.
      </p>
      <button type="button" className="btn-primary mt-4" onClick={openSignIn}>
        Sign in
      </button>
    </div>
  );
}

const Account = () => {
  usePageMeta({ title: "Account", description: "Your singlet.bio account: today's AI usage and API keys for scripts and the MCP server.", noindex: true });
  const { user, loading, openSignIn, signOut } = useAuth();

  const usage = useUsageToday(!!user);
  const searchQuota = useAiQuota("search");
  const explainQuota = useAiQuota("explain");
  const searchUsed = usage?.search ?? (searchQuota?.kind === "user" ? searchQuota.used : null);
  const explainUsed = usage?.explain ?? (explainQuota?.kind === "user" ? explainQuota.used : null);

  // ── API keys ──
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ secret: string; key: ApiKeySummary } | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setKeysError(null);
    try {
      setKeys(await apiClient.apiKeys.list());
    } catch (e) {
      setKeys([]);
      setKeysError(isApiError(e) ? e.message : "Could not load your API keys.");
    }
  }, []);

  useEffect(() => {
    if (user) void load();
    else {
      setKeys(null);
      setRevealed(null);
    }
  }, [user, load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) {
      setFormError("Give the key a name so you can recognise it later, e.g. “laptop” or “Claude Desktop”.");
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      const r = await apiClient.apiKeys.create(n, expiry);
      setRevealed(r);
      setName("");
      setKeys((prev) => [r.key, ...(prev ?? [])]);
    } catch (err) {
      setFormError(isApiError(err) ? err.message : "Could not create the key right now.");
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    try {
      await apiClient.apiKeys.revoke(id);
      const now = new Date().toISOString();
      setKeys((prev) => (prev ?? []).map((k) => (k.id === id ? { ...k, revoked_at: now } : k)));
      if (revealed?.key.id === id) setRevealed(null);
    } catch (err) {
      setKeysError(isApiError(err) ? err.message : "Could not revoke the key right now.");
    } finally {
      setRevoking(null);
      setConfirmId(null);
    }
  };

  const activeCount = useMemo(() => (keys ?? []).filter((k) => keyState(k) === "active").length, [keys]);

  const curl = revealed
    ? `curl -H "Authorization: Bearer ${revealed.secret}" \\\n  "https://singlet.bio/api/nl-search?q=microglia+in+the+aging+mouse+brain"`
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="container-site flex-1 py-10 md:py-14">
        {loading ? (
          <div className="h-6 w-40 rounded bg-secondary animate-pulse" aria-hidden="true" />
        ) : !user ? (
          <SignedOut openSignIn={() => openSignIn()} />
        ) : (
          <div className="max-w-[820px] space-y-8">
            <header>
              <h1 className="font-display text-[26px] md:text-[30px] font-semibold tracking-tight text-foreground">Account</h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                Signed in as <span className="font-medium text-foreground break-all">{user.email ?? user.id}</span>
              </p>
            </header>

            {/* ── Plan + usage ── */}
            <section className="surface p-5" aria-labelledby="usage-h">
              <h2 id="usage-h" className="text-[15px] font-semibold text-foreground">
                Plan and today's AI usage
              </h2>
              <dl className="mt-3 grid sm:grid-cols-3 gap-4 text-[13.5px]">
                <div>
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="mt-0.5 font-medium text-foreground">Free</dd>
                  <dd className="text-[12px] text-muted-foreground">The only plan. Data and downloads are free for everyone.</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">AI searches</dt>
                  <dd className="mt-0.5 font-medium tabular text-foreground">
                    {searchUsed == null ? <span className="inline-block h-4 w-14 rounded bg-secondary animate-pulse" /> : `${fmtInt(searchUsed)} / ${SEARCH_LIMIT}`}
                  </dd>
                  <dd className="text-[12px] text-muted-foreground">Website and API keys share this budget.</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">AI explanations</dt>
                  <dd className="mt-0.5 font-medium tabular text-foreground">
                    {explainUsed == null ? <span className="inline-block h-4 w-14 rounded bg-secondary animate-pulse" /> : `${fmtInt(explainUsed)} / ${EXPLAIN_LIMIT}`}
                  </dd>
                  <dd className="text-[12px] text-muted-foreground">Resets at 00:00 UTC.</dd>
                </div>
              </dl>
            </section>

            {/* ── API keys ── */}
            <section className="surface p-5" aria-labelledby="keys-h">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="keys-h" className="text-[15px] font-semibold text-foreground inline-flex items-center gap-2">
                    <KeyRound size={16} className="text-primary" aria-hidden="true" />
                    API keys
                  </h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    A key lets scripts, the <code className="code-inline">singlet</code> packages and the MCP server run natural-language searches
                    under your account. Downloads never need one.{" "}
                    <Link to="/docs#api-keys" className="text-primary hover:underline">
                      How to use a key →
                    </Link>
                  </p>
                </div>
              </div>

              {revealed && (
                <div className="mt-4 warning-surface p-4" role="status" aria-live="polite">
                  <p className="text-[13.5px] font-medium text-foreground">
                    Your new key “{revealed.key.name}” — copy it now. It will not be shown again.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="flex-1 min-w-0 block font-mono text-[12.5px] bg-card border border-border px-2.5 py-2 break-all select-all">
                      {revealed.secret}
                    </code>
                    <CopyButton text={revealed.secret} />
                  </div>
                  {curl && (
                    <div className="mt-3">
                      <CodeBlock code={curl} label="bash" />
                    </div>
                  )}
                  <button
                    type="button"
                    className="mt-3 text-[12.5px] text-muted-foreground hover:text-foreground underline underline-offset-2"
                    onClick={() => setRevealed(null)}
                  >
                    I've saved it
                  </button>
                </div>
              )}

              <form onSubmit={create} className="mt-4 grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end" noValidate>
                <div>
                  <label htmlFor="key-name" className="block text-[12.5px] font-medium text-foreground mb-1">
                    Name
                  </label>
                  <input
                    id="key-name"
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. laptop, Claude Desktop, HPC pipeline"
                    maxLength={60}
                    disabled={creating}
                  />
                </div>
                <div>
                  <label htmlFor="key-expiry" className="block text-[12.5px] font-medium text-foreground mb-1">
                    Expires
                  </label>
                  <select
                    id="key-expiry"
                    className="input sm:w-32"
                    value={expiry === null ? "" : String(expiry)}
                    onChange={(e) => setExpiry(e.target.value === "" ? null : Number(e.target.value))}
                    disabled={creating}
                  >
                    {EXPIRY_OPTIONS.map((o) => (
                      <option key={o.label} value={o.days === null ? "" : String(o.days)}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn-primary h-10" disabled={creating}>
                  {creating && <Loader2 size={14} className="animate-spin" />}
                  Create key
                </button>
              </form>
              {formError && (
                <p role="alert" className="mt-2 text-[13px] text-destructive">
                  {formError}
                </p>
              )}

              <div className="mt-5">
                {keys === null ? (
                  <div className="space-y-2" aria-hidden="true">
                    <div className="h-9 rounded bg-secondary animate-pulse" />
                    <div className="h-9 rounded bg-secondary animate-pulse" />
                  </div>
                ) : keys.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No keys yet. Create one above; it works immediately.</p>
                ) : (
                  <div className="overflow-x-auto -mx-5 px-5">
                    <table className="w-full text-[13px]">
                      <caption className="sr-only">Your API keys</caption>
                      <thead>
                        <tr className="text-left text-[11.5px] uppercase tracking-wide text-muted-foreground border-b border-border">
                          <th className="py-2 pr-3 font-medium">Name</th>
                          <th className="py-2 pr-3 font-medium">Key</th>
                          <th className="py-2 pr-3 font-medium">Created</th>
                          <th className="py-2 pr-3 font-medium">Last used</th>
                          <th className="py-2 pr-3 font-medium">Expires</th>
                          <th className="py-2 font-medium text-right">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {keys.map((k) => {
                          const state = keyState(k);
                          const dead = state !== "active";
                          return (
                            <tr key={k.id} className={cn("border-b border-border last:border-0", dead && "text-muted-foreground")}>
                              <td className="py-2.5 pr-3">
                                <span className={cn("font-medium", !dead && "text-foreground")}>{k.name}</span>
                                {dead && <span className="ml-2 text-[11px] uppercase tracking-wide">{state}</span>}
                              </td>
                              <td className="py-2.5 pr-3 font-mono text-[12px] whitespace-nowrap">{k.key_prefix}…</td>
                              <td className="py-2.5 pr-3 whitespace-nowrap">{fmtDate(k.created_at)}</td>
                              <td className="py-2.5 pr-3 whitespace-nowrap">{fmtWhen(k.last_used_at)}</td>
                              <td className="py-2.5 pr-3 whitespace-nowrap">{k.expires_at ? fmtDate(k.expires_at) : "never"}</td>
                              <td className="py-2.5 text-right whitespace-nowrap">
                                {!dead &&
                                  (confirmId === k.id ? (
                                    <span className="inline-flex items-center gap-1.5">
                                      <span className="text-[12px] text-muted-foreground">Revoke?</span>
                                      <button type="button" className="btn-secondary btn-sm" onClick={() => revoke(k.id)} disabled={revoking === k.id}>
                                        {revoking === k.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                        Yes, revoke
                                      </button>
                                      <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirmId(null)}>
                                        Keep
                                      </button>
                                    </span>
                                  ) : (
                                    <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirmId(k.id)} aria-label={`Revoke ${k.name}`}>
                                      <Trash2 size={13} />
                                      Revoke
                                    </button>
                                  ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {keysError && (
                  <p role="alert" className="mt-2 text-[13px] text-destructive">
                    {keysError}
                  </p>
                )}
                {keys && keys.length > 0 && (
                  <p className="mt-3 text-[12px] text-muted-foreground">
                    {activeCount} active {activeCount === 1 ? "key" : "keys"} (up to 20). Only the first characters and a hash are stored; a revoked key stops
                    working within a minute.
                  </p>
                )}
              </div>
            </section>

            <section className="flex items-center justify-between gap-4 text-[13px] text-muted-foreground">
              <p>
                We store your email, a daily count of AI requests and the keys above, nothing else.{" "}
                <Link to="/privacy" className="text-primary hover:underline">
                  Privacy
                </Link>
              </p>
              <button type="button" className="btn-ghost btn-sm" onClick={() => void signOut()}>
                Sign out
              </button>
            </section>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Account;

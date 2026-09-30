/**
 * /auth/callback — where a sign-in lands when it could not finish.
 *
 * A successful GitHub or Google round-trip never shows this page: the
 * Pages Function sets the session cookie and redirects straight back to
 * where the visitor started. Failures arrive as
 * ?error=<code>&provider=<github|google> (see functions/_shared/oauth.ts);
 * this page explains them and offers a retry. Reached without an error, it
 * waits for the session and sends the visitor on to the saved return path.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { usePageMeta } from "@/hooks/usePageMeta";
import { peekReturnPath, takeReturnPath, useAuth, type OAuthProviderName } from "@/components/auth/AuthProvider";

const WAIT_MS = 8_000;
const LABEL: Record<OAuthProviderName, string> = { github: "GitHub", google: "Google" };

interface Failure {
  code: string;
  provider: OAuthProviderName | null;
}

function readUrl(): Failure | null {
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const code = query.get("error");
  if (!code) return null;
  const p = query.get("provider");
  return { code, provider: p === "github" || p === "google" ? p : null };
}

function explain({ code, provider }: Failure): string {
  const name = provider ? LABEL[provider] : "The provider";
  const other = provider === "github" ? "Google" : provider === "google" ? "GitHub" : null;
  switch (code) {
    case "not_configured":
      return `${provider ? LABEL[provider] : "This"} sign-in isn't set up on this site yet.${other ? ` You can continue with ${other} instead.` : ""}`;
    case "access_denied":
      return `${provider ? LABEL[provider] : "The"} sign-in was cancelled, so nothing was shared with singlet.bio.`;
    case "state_expired":
    case "invalid_state":
      return "That sign-in attempt expired or was already used (each one is good for 10 minutes). Please start again.";
    case "browser_mismatch":
      return "This sign-in was finished in a different browser from the one that started it, or cookies are blocked for singlet.bio. Please start again here.";
    case "missing_code":
    case "provider_error":
      return `${name} didn't complete the sign-in. Please try again.`;
    case "exchange_failed":
    case "profile_failed":
      return `We couldn't confirm your account with ${provider ? LABEL[provider] : "the provider"}. Please try again in a moment.`;
    case "no_verified_email":
      return provider === "github"
        ? "Your GitHub account has no verified email address. Verify one at github.com/settings/emails, or continue with Google."
        : `${name} didn't confirm an email address for this account, and singlet.bio accounts need one.${other ? ` Try ${other} instead.` : ""}`;
    case "account_failed":
    case "unavailable":
      return "Something went wrong on our side while signing you in. Please try again in a moment.";
    default:
      return "Sign-in didn't complete. Please try again.";
  }
}

const AuthCallback = () => {
  usePageMeta({ title: "Signing in", path: "/auth/callback", noindex: true });
  const navigate = useNavigate();
  const { user, loading, openSignIn, signInWithOAuth } = useAuth();
  const failure = useMemo(readUrl, []);
  const [timedOut, setTimedOut] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const backTo = useMemo(peekReturnPath, []);

  // No error: the session should already be there — move on once it is.
  useEffect(() => {
    if (failure) return;
    if (user) {
      navigate(takeReturnPath(), { replace: true });
      return;
    }
    const t = window.setTimeout(() => setTimedOut(true), WAIT_MS);
    return () => window.clearTimeout(t);
  }, [failure, user, navigate]);

  const message = failure
    ? explain(failure)
    : timedOut && !loading && !user
      ? "We couldn't find a signed-in session in this browser. Cookies may be blocked for singlet.bio, or the sign-in was started in a different browser."
      : null;

  // Retrying the same provider makes sense unless it isn't configured at all.
  const retryProvider = failure?.provider && failure.code !== "not_configured" ? failure.provider : null;
  const retry = async () => {
    setRetryError(null);
    if (!retryProvider) {
      openSignIn();
      return;
    }
    const r = await signInWithOAuth(retryProvider);
    if (r.error) setRetryError(r.error);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-5 text-center">
      <Logo height={22} />
      {message ? (
        <div className="mt-6 max-w-[380px]">
          <h1 className="text-[17px] font-semibold text-foreground">Sign-in didn't complete</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{message}</p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <button type="button" className="btn-primary btn-sm" onClick={() => void retry()}>
              {retryProvider ? `Try ${LABEL[retryProvider]} again` : "Try again"}
            </button>
            {retryProvider && (
              <button type="button" className="btn-secondary btn-sm" onClick={() => openSignIn()}>
                Other options
              </button>
            )}
            <Link to={backTo} className="btn-secondary btn-sm">
              Go back
            </Link>
          </div>
          {retryError && (
            <p role="alert" className="mt-3 text-[13px] leading-snug text-destructive">
              {retryError}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-6 inline-flex items-center gap-2 text-[14px] text-muted-foreground" aria-live="polite">
          <Loader2 size={16} className="animate-spin" /> Signing you in…
        </p>
      )}
    </main>
  );
};

export default AuthCallback;

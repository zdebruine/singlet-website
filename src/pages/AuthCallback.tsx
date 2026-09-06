/**
 * /auth/callback — where every sign-in round-trip lands.
 *
 *  - Email link and Google: the auth client reads the tokens out of the URL
 *    on load; this page waits for the session and sends the visitor back.
 *  - GitHub: arrives as ?provider=github&code=…&state=… (relayed by
 *    singlet.bio/auth/github/callback); the code is exchanged for a one-time
 *    token here, then the same wait-for-session path applies.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { usePageMeta } from "@/hooks/usePageMeta";
import { takeReturnPath, useAuth } from "@/components/auth/AuthProvider";

const WAIT_MS = 10_000;

interface GitHubLeg {
  code: string;
  state: string;
}

function readUrl(): { error: string | null; github: GitHubLeg | null } {
  if (typeof window === "undefined") return { error: null, github: null };
  const query = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const provider = query.get("provider");

  const code = query.get("code");
  const state = query.get("state");
  const github = provider === "github" && code && state ? { code, state } : null;

  const raw = hashParams.get("error_description") ?? query.get("error_description") ?? hashParams.get("error") ?? query.get("error");
  if (!raw) return { error: null, github };
  const d = raw.replace(/\+/g, " ");
  if (provider === "github") {
    if (d === "access_denied") return { error: "GitHub sign-in was cancelled. You can try again or use your email instead.", github: null };
    if (d === "invalid_state" || d === "missing_code") return { error: "That GitHub sign-in attempt expired or was incomplete. Please try again.", github: null };
    return { error: d, github: null };
  }
  if (/expired|invalid/i.test(d)) return { error: "That sign-in link has expired or was already used. Request a new one below.", github: null };
  return { error: d, github: null };
}

const AuthCallback = () => {
  usePageMeta({ title: "Signing in", path: "/auth/callback", noindex: true });
  const navigate = useNavigate();
  const { user, loading, openSignIn, finishGitHubSignIn } = useAuth();
  const initial = useMemo(readUrl, []);
  const [error, setError] = useState<string | null>(initial.error);
  const [timedOut, setTimedOut] = useState(false);
  const githubStarted = useRef(false);

  // GitHub leg: exchange the code once, then let the session listener take over.
  useEffect(() => {
    if (!initial.github || githubStarted.current) return;
    githubStarted.current = true;
    // Drop the one-time code from the address bar before doing anything else.
    window.history.replaceState(null, "", "/auth/callback");
    finishGitHubSignIn(initial.github.code, initial.github.state).then((r) => {
      if (r.error) setError(r.error);
    });
  }, [initial.github, finishGitHubSignIn]);

  useEffect(() => {
    if (user) {
      navigate(takeReturnPath(), { replace: true });
      return;
    }
    if (error) return;
    const t = window.setTimeout(() => setTimedOut(true), initial.github ? WAIT_MS * 2 : WAIT_MS);
    return () => window.clearTimeout(t);
  }, [user, error, initial.github, navigate]);

  const failed =
    error ?? (timedOut && !loading && !user ? "We couldn't finish signing you in. The link may have been opened in a different browser than the one it was requested from." : null);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-5 text-center">
      <Logo height={22} />
      {failed ? (
        <div className="mt-6 max-w-[380px]">
          <h1 className="text-[17px] font-semibold text-foreground">Sign-in didn't complete</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{failed}</p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button type="button" className="btn-primary btn-sm" onClick={() => openSignIn()}>
              Try again
            </button>
            <Link to="/" className="btn-secondary btn-sm">
              Back to search
            </Link>
          </div>
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

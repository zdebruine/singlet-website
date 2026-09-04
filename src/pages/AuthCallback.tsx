/**
 * /auth/callback — where the email link and Google round-trip land.
 * The auth client reads the tokens out of the URL on load; this page just
 * waits for the session and sends the visitor back to where they were.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/Logo";
import { usePageMeta } from "@/hooks/usePageMeta";
import { takeReturnPath, useAuth } from "@/components/auth/AuthProvider";

const WAIT_MS = 10_000;

function urlError(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, "") || window.location.search);
  const desc = params.get("error_description") ?? params.get("error");
  if (!desc) return null;
  const d = desc.replace(/\+/g, " ");
  if (/expired|invalid/i.test(d)) return "That sign-in link has expired or was already used. Request a new one below.";
  return d;
}

const AuthCallback = () => {
  usePageMeta({ title: "Signing in", path: "/auth/callback", noindex: true });
  const navigate = useNavigate();
  const { user, loading, openSignIn } = useAuth();
  const initialError = useMemo(urlError, []);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (user) {
      navigate(takeReturnPath(), { replace: true });
      return;
    }
    if (initialError) return;
    const t = window.setTimeout(() => setTimedOut(true), WAIT_MS);
    return () => window.clearTimeout(t);
  }, [user, initialError, navigate]);

  const failed = initialError ?? (timedOut && !loading && !user ? "We couldn't finish signing you in. The link may have been opened in a different browser than the one it was requested from." : null);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-5 text-center">
      <Logo size={22} />
      {failed ? (
        <div className="mt-6 max-w-[380px]">
          <h1 className="text-[17px] font-semibold text-foreground">Sign-in didn't complete</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{failed}</p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button type="button" className="btn-primary btn-sm" onClick={() => openSignIn()}>
              Send a new link
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

import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Github, Loader2, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Logo } from "@/components/Logo";
import type { OAuthProviderName, SignInResult } from "./AuthProvider";

interface Props {
  open: boolean;
  reason?: string;
  onOpenChange: (open: boolean) => void;
  signInWithEmail: (email: string) => Promise<SignInResult>;
  signInWithOAuth: (provider: OAuthProviderName) => Promise<SignInResult>;
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="var(--google-red)" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="var(--google-blue)" d="M46.5 24.5c0-1.6-.1-2.8-.4-4H24v7.6h12.8c-.3 2.1-1.7 5.3-4.8 7.4l7.4 5.7c4.4-4.1 7.1-10.1 7.1-16.7z" />
      <path fill="var(--google-yellow)" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.5 0 20.1 0 24s1 7.5 2.6 10.7l7.8-6z" />
      <path fill="var(--google-green)" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2 1.4-4.7 2.4-8.5 2.4-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function SignInDialog({ open, reason, onOpenChange, signInWithEmail, signInWithOAuth }: Props) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"email" | OAuthProviderName | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBusy(null);
      setError(null);
      setSentTo(null);
    }
  }, [open]);

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) {
      setError("Enter the email address you want the sign-in link sent to.");
      return;
    }
    setError(null);
    setBusy("email");
    const r = await signInWithEmail(addr);
    setBusy(null);
    if (r.error) setError(r.error);
    else setSentTo(addr);
  };

  const oauth = async (provider: OAuthProviderName) => {
    setError(null);
    setBusy(provider);
    const r = await signInWithOAuth(provider);
    // On success the page navigates away; only failures come back here.
    setBusy(null);
    if (r.error) setError(r.error);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dialog-surface max-w-[400px] border-border p-6 gap-0">
        <DialogHeader className="text-left space-y-1.5">
          <Logo variant="mark" height={32} link={false} className="mb-2" />
          <DialogTitle className="font-display text-[19px] font-semibold tracking-tight">Sign in to singlet.bio</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
            {reason ?? "Free, and only needed for more AI: 200 AI searches a day instead of 10, AI explanations of why a study matches, and API keys for scripts."}{" "}
            Browsing and downloading never need an account.
          </DialogDescription>
        </DialogHeader>

        {sentTo ? (
          <div className="mt-5" aria-live="polite">
            <div className="surface p-4 flex gap-3">
              <Mail size={18} className="text-primary shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-foreground">Check your inbox</p>
                <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
                  We sent a sign-in link to <span className="font-medium text-foreground break-all">{sentTo}</span>. It works once and expires in an hour. No password needed.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="mt-3 text-[12.5px] text-muted-foreground hover:text-foreground underline underline-offset-2"
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div className="space-y-2">
              <button type="button" onClick={() => oauth("google")} disabled={busy !== null} className="btn-secondary w-full h-10">
                {busy === "google" ? <Loader2 size={15} className="animate-spin" /> : <GoogleMark />}
                Continue with Google
              </button>
              <button type="button" onClick={() => oauth("github")} disabled={busy !== null} className="btn-secondary w-full h-10">
                {busy === "github" ? <Loader2 size={15} className="animate-spin" /> : <Github size={16} aria-hidden="true" />}
                Continue with GitHub
              </button>
            </div>

            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={submitEmail} className="space-y-2" noValidate>
              <label htmlFor="signin-email" className="block text-[12.5px] font-medium text-foreground">
                Email
              </label>
              <input
                id="signin-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@university.edu"
                className="input"
                disabled={busy !== null}
              />
              <button type="submit" disabled={busy !== null} className="btn-primary w-full h-10">
                {busy === "email" && <Loader2 size={15} className="animate-spin" />}
                Email me a sign-in link
              </button>
            </form>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-[13px] leading-snug text-destructive">
            {error}
          </p>
        )}

        <p className="mt-5 text-[11.5px] leading-relaxed text-muted-foreground">
          We store your email, a daily count of AI requests and the API keys you create, nothing else. See the{" "}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground" onClick={() => onOpenChange(false)}>
            privacy policy
          </Link>{" "}
          and{" "}
          <Link to="/terms" className="underline underline-offset-2 hover:text-foreground" onClick={() => onOpenChange(false)}>
            terms
          </Link>
          .
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default SignInDialog;

/**
 * Optional accounts. Signing in is free and only changes AI budgets
 * (200 AI searches a day instead of 10, plus AI explanations) and unlocks
 * API keys for scripts and the MCP server. Browsing, searching and
 * downloading never need it.
 *
 * The auth client is loaded lazily so anonymous page views never pay for it.
 * The provider is the single writer of the module-level `authToken`, which the
 * API client attaches to AI requests.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { authToken } from "@/lib/auth-token";
import { aiQuotaStore } from "@/lib/ai-quota";
import { SignInDialog } from "./SignInDialog";

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface SignInResult {
  error?: string;
}

export type OAuthProviderName = "google" | "github";

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the stored session (if any) has been read once. */
  loading: boolean;
  signInWithEmail: (email: string) => Promise<SignInResult>;
  signInWithOAuth: (provider: OAuthProviderName) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Open the sign-in dialog from anywhere (quota cards, nav). */
  openSignIn: (opts?: { reason?: string }) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const RETURN_KEY = "singlet:auth:return";
const PROVIDER_LABEL: Record<OAuthProviderName, string> = { google: "Google", github: "GitHub" };

function unavailable(provider: OAuthProviderName): string {
  return `${PROVIDER_LABEL[provider]} sign-in isn't available on this site yet — use your email instead.`;
}

function isLovableHost(host = typeof window !== "undefined" ? window.location.hostname : ""): boolean {
  return /(^|\.)(lovable\.app|lovableproject\.com|lovable\.dev)$/.test(host);
}

/** Where to land after the email link / OAuth round-trip. */
export function rememberReturnPath() {
  try {
    const { pathname, search, hash } = window.location;
    if (pathname.startsWith("/auth/")) return;
    window.localStorage.setItem(RETURN_KEY, pathname + search + hash);
  } catch {
    /* ignore */
  }
}

export function takeReturnPath(): string {
  try {
    const v = window.localStorage.getItem(RETURN_KEY);
    window.localStorage.removeItem(RETURN_KEY);
    if (v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/auth/")) return v;
  } catch {
    /* ignore */
  }
  return "/browse";
}

function toUser(session: Session | null): AuthUser | null {
  if (!session?.user) return null;
  return { id: session.user.id, email: session.user.email ?? null };
}

function humanAuthError(message: string, provider?: OAuthProviderName): string {
  const m = message.toLowerCase();
  if (m.includes("rate limit") || m.includes("too many")) return "Too many sign-in emails were requested just now — please try again in a few minutes.";
  if (m.includes("invalid") && m.includes("email")) return "That doesn't look like a valid email address.";
  if (m.includes("signups not allowed") || m.includes("signup")) return "New accounts are closed at the moment.";
  if (m.includes("unsupported provider") || m.includes("oauth secret") || m.includes("provider is not enabled")) {
    return unavailable(provider ?? "google");
  }
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ open: boolean; reason?: string }>({ open: false });
  const clientRef = useRef<Promise<SupabaseClient> | null>(null);
  const lastUserId = useRef<string | null | undefined>(undefined);

  const client = useCallback((): Promise<SupabaseClient> => {
    if (!clientRef.current) {
      clientRef.current = import("@/integrations/supabase/client").then((m) => m.supabase as unknown as SupabaseClient);
    }
    return clientRef.current;
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const apply = (session: Session | null) => {
      if (cancelled) return;
      const u = toUser(session);
      authToken.set(session?.access_token ?? null);
      setUser(u);
      // A different subject means a different budget — drop the stale counter.
      if (lastUserId.current !== undefined && lastUserId.current !== (u?.id ?? null)) aiQuotaStore.clear();
      lastUserId.current = u?.id ?? null;
    };

    client()
      .then((sb) => {
        const { data } = sb.auth.onAuthStateChange((_event, session) => apply(session));
        unsubscribe = () => data.subscription.unsubscribe();
        return sb.auth.getSession();
      })
      .then(({ data }) => {
        apply(data.session);
        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [client]);

  const signInWithEmail = useCallback(
    async (email: string): Promise<SignInResult> => {
      const sb = await client();
      rememberReturnPath();
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
      });
      return error ? { error: humanAuthError(error.message) } : {};
    },
    [client],
  );

  const signInWithOAuth = useCallback(
    async (provider: OAuthProviderName): Promise<SignInResult> => {
      rememberReturnPath();
      const redirect = `${window.location.origin}/auth/callback`;

      // GitHub: the hosted auth settings can't hold a GitHub app, so a Cloud
      // function runs the OAuth exchange. The callback lands on
      // /auth/callback?provider=github&code=…&state=… (see finishGitHubSignIn).
      if (provider === "github") {
        try {
          const { apiClient } = await import("@/integrations/api/client");
          const { pathname, search, hash } = window.location;
          const { url, nonce } = await apiClient.githubOAuth.start(window.location.origin, pathname.startsWith("/auth/") ? "/browse" : pathname + search + hash);
          try {
            window.sessionStorage.setItem(GITHUB_NONCE_KEY, nonce);
          } catch {
            /* private mode — the exchange still verifies the signed state */
          }
          window.location.assign(url);
          return {};
        } catch (e) {
          const status = (e as { status?: number }).status;
          if (status === 503) return { error: unavailable("github") };
          return { error: humanAuthError(e instanceof Error ? e.message : String(e), provider) };
        }
      }

      // Lovable-hosted previews sign in with Google through Lovable's managed
      // Google app; if that broker declines, fall through to the project's own
      // Google app below.
      if (isLovableHost()) {
        try {
          const { lovable } = await import("@/integrations/lovable");
          const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: redirect });
          if (!("error" in r && r.error)) return {};
        } catch {
          /* fall through */
        }
      }

      // singlet.bio and *.pages.dev previews: the project's own Google app must
      // be configured. Probe before redirecting so a missing configuration
      // shows a sentence here instead of a bare error page.
      const sb = await client();
      const { data, error } = await sb.auth.signInWithOAuth({
        provider,
        options: { redirectTo: redirect, skipBrowserRedirect: true },
      });
      if (error || !data?.url) return { error: humanAuthError(error?.message ?? `${PROVIDER_LABEL[provider]} sign-in could not start.`, provider) };
      try {
        const probe = await fetch(data.url, { redirect: "manual", credentials: "omit" });
        if (probe.status >= 400) return { error: unavailable(provider) };
      } catch {
        /* opaque redirect or network hiccup — let the real navigation decide */
      }
      window.location.assign(data.url);
      return {};
    },
    [client],
  );

  const finishGitHubSignIn = useCallback(
    async (code: string, state: string): Promise<SignInResult> => {
      let expectedNonce: string | null = null;
      try {
        expectedNonce = window.sessionStorage.getItem(GITHUB_NONCE_KEY);
        window.sessionStorage.removeItem(GITHUB_NONCE_KEY);
      } catch {
        /* ignore */
      }
      try {
        const { apiClient } = await import("@/integrations/api/client");
        const { tokenHash, returnTo, nonce } = await apiClient.githubOAuth.exchange(code, state);
        // A callback this browser never started (login CSRF) is refused.
        if (expectedNonce && nonce && expectedNonce !== nonce) {
          return { error: "This sign-in was started in a different browser tab or window. Please try again from here." };
        }
        const sb = await client();
        const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
        if (error) return { error: humanAuthError(error.message, "github") };
        try {
          window.localStorage.setItem(RETURN_KEY, returnTo);
        } catch {
          /* ignore */
        }
        return {};
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 503) return { error: unavailable("github") };
        return { error: humanAuthError(e instanceof Error ? e.message : String(e), "github") };
      }
    },
    [client],
  );

  const signOut = useCallback(async () => {
    const sb = await client();
    await sb.auth.signOut();
    authToken.set(null);
    setUser(null);
    aiQuotaStore.clear();
  }, [client]);

  const openSignIn = useCallback((opts?: { reason?: string }) => setDialog({ open: true, reason: opts?.reason }), []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signInWithEmail, signInWithOAuth, signOut, openSignIn }),
    [user, loading, signInWithEmail, signInWithOAuth, signOut, openSignIn],
  );

  // Signing in while the dialog is open (e.g. OAuth popup) closes it.
  useEffect(() => {
    if (user && dialog.open) setDialog({ open: false });
  }, [user, dialog.open]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SignInDialog
        open={dialog.open}
        reason={dialog.reason}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        signInWithEmail={signInWithEmail}
        signInWithOAuth={signInWithOAuth}
      />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/**
 * Optional accounts. Signing in is free and only changes AI budgets
 * (200 AI searches a day instead of 10, plus AI explanations) and unlocks
 * API keys for scripts and the MCP server. Browsing, searching and
 * downloading never need it.
 *
 * Providers: GitHub and Google, both OAuth apps of our own driven by Pages
 * Functions (functions/_shared/oauth.ts). Signing in is a full-page redirect
 * to /auth/<provider>/start; the session then lives in an HttpOnly cookie the
 * page never sees. This provider only asks /api/auth/me who is signed in (on
 * mount, and again on window focus at most every 5 minutes) and which
 * providers the deployment offers.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiClient } from "@/integrations/api/client";
import { aiQuotaStore } from "@/lib/ai-quota";
import { SignInDialog } from "./SignInDialog";

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface SignInResult {
  error?: string;
}

export type OAuthProviderName = "google" | "github";

/** Which sign-in providers this deployment has configured. */
export type AuthProviders = Record<OAuthProviderName, boolean>;

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the session has been checked once. */
  loading: boolean;
  /** Configured providers. Optimistically all true until /api/auth/me answers. */
  providers: AuthProviders;
  /** Full-page redirect to the provider; resolves only with an error. */
  signInWithOAuth: (provider: OAuthProviderName) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Open the sign-in dialog from anywhere (quota cards, nav). */
  openSignIn: (opts?: { reason?: string }) => void;
  /** Ask the server again who is signed in. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const RETURN_KEY = "singlet:auth:return";
const DEFAULT_RETURN = "/browse";
const RECHECK_MS = 5 * 60_000;
const PROVIDER_LABEL: Record<OAuthProviderName, string> = { google: "Google", github: "GitHub" };
const ALL_PROVIDERS: AuthProviders = { github: true, google: true };

function isReturnPath(v: string | null | undefined): v is string {
  return !!v && v.length <= 512 && v.startsWith("/") && !v.startsWith("//") && !/[\\\s]/.test(v) && !/^\/auth(?:[/?#]|$)/.test(v);
}

/** The return path saved when the last sign-in started in this tab (or /browse). */
export function peekReturnPath(): string {
  try {
    const v = window.sessionStorage.getItem(RETURN_KEY);
    if (isReturnPath(v)) return v;
  } catch {
    /* private mode */
  }
  return DEFAULT_RETURN;
}

/** Like peekReturnPath, but forgets it. */
export function takeReturnPath(): string {
  const v = peekReturnPath();
  try {
    window.sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* ignore */
  }
  return v;
}

/** Where to land after the round-trip: this page, unless we are on an auth page already. */
function currentReturnPath(): string {
  const { pathname, search, hash } = window.location;
  const here = pathname + search + hash;
  return isReturnPath(here) ? here : peekReturnPath();
}

function sameUser(a: AuthUser | null, b: AuthUser | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.email === b.email && a.displayName === b.displayName && a.avatarUrl === b.avatarUrl;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [providers, setProviders] = useState<AuthProviders>(ALL_PROVIDERS);
  const [dialog, setDialog] = useState<{ open: boolean; reason?: string }>({ open: false });
  const lastUserId = useRef<string | null | undefined>(undefined);
  const lastCheck = useRef(0);

  const refresh = useCallback(async () => {
    lastCheck.current = Date.now();
    try {
      const me = await apiClient.auth.me();
      const u = me.user;
      // A different subject means a different budget — drop the stale counter.
      if (lastUserId.current !== undefined && lastUserId.current !== (u?.id ?? null)) aiQuotaStore.clear();
      lastUserId.current = u?.id ?? null;
      // Keep object identity when nothing changed, so consumers' effects don't re-run.
      setUser((prev) => (sameUser(prev, u) ? prev : u));
      setProviders((prev) => (prev.github === me.providers.github && prev.google === me.providers.google ? prev : me.providers));
    } catch {
      /* offline or the API is down: keep what we had */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => {
      if (Date.now() - lastCheck.current >= RECHECK_MS) void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const signInWithOAuth = useCallback(
    async (provider: OAuthProviderName): Promise<SignInResult> => {
      if (!providers[provider]) return { error: `${PROVIDER_LABEL[provider]} sign-in isn't available on this site yet.` };
      const returnTo = currentReturnPath();
      try {
        window.sessionStorage.setItem(RETURN_KEY, returnTo);
      } catch {
        /* the server carries return_to anyway */
      }
      window.location.assign(apiClient.auth.startUrl(provider, returnTo));
      return {};
    },
    [providers],
  );

  const signOut = useCallback(async () => {
    await apiClient.auth.logout();
    lastUserId.current = null;
    setUser(null);
    aiQuotaStore.clear();
  }, []);

  const openSignIn = useCallback((opts?: { reason?: string }) => setDialog({ open: true, reason: opts?.reason }), []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, providers, signInWithOAuth, signOut, openSignIn, refresh }),
    [user, loading, providers, signInWithOAuth, signOut, openSignIn, refresh],
  );

  // Signing in while the dialog is open (e.g. in another tab, noticed on focus) closes it.
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
        providers={providers}
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

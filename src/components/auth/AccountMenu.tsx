import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Loader2, LogOut, UserRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import { useAiQuota } from "@/lib/ai-quota";
import { apiClient, isApiError } from "@/integrations/api/client";
import { useAuth } from "./AuthProvider";

export interface UsageToday {
  search: number;
  explain: number;
  /** This deployment's daily limits, when the server reported them. */
  searchLimit?: number | null;
  explainLimit?: number | null;
}

/**
 * Today's counters straight from the database (the local copy can be stale on
 * a new device). On failure `usage` stays null, so callers fall back to the
 * local count or a placeholder rather than showing zeros.
 */
export function useUsageToday(enabled: boolean): { usage: UsageToday | null; failed: boolean } {
  const { refresh } = useAuth();
  const [state, setState] = useState<{ usage: UsageToday | null; failed: boolean }>({ usage: null, failed: false });
  useEffect(() => {
    setState({ usage: null, failed: false });
    if (!enabled) return;
    const controller = new AbortController();
    apiClient.auth
      .usage(controller.signal)
      .then((u) => {
        if (!controller.signal.aborted) setState({ usage: u, failed: false });
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setState({ usage: null, failed: true });
        // The session ended elsewhere: let the nav catch up.
        if (isApiError(e) && e.status === 401) void refresh();
      });
    return () => controller.abort();
  }, [enabled, refresh]);
  return state;
}

function UsageValue({ used, limit, failed }: { used: number | null; limit: number; failed: boolean }) {
  if (used != null) return <>{`${fmtInt(used)} / ${fmtInt(limit)}`}</>;
  if (failed) return <span className="text-muted-foreground">— / {fmtInt(limit)}</span>;
  return <span className="inline-block h-3 w-10 rounded bg-secondary animate-pulse" />;
}

/** Nav slot: "Sign in" when anonymous, a small account popover when signed in. */
export function AccountMenu({ className, variant = "nav" }: { className?: string; variant?: "nav" | "menu" }) {
  const { user, loading, signOut, openSignIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const { usage, failed: usageFailed } = useUsageToday(open && !!user);
  const searchQuota = useAiQuota("search");
  const explainQuota = useAiQuota("explain");

  // A stale error shouldn't greet the next opening; nor should the popover
  // spring back open if the visitor signs in again without a reload.
  useEffect(() => {
    if (!open) setSignOutError(null);
  }, [open]);
  useEffect(() => {
    if (!user) setOpen(false);
  }, [user]);

  const handleSignOut = async () => {
    setSignOutError(null);
    setSigningOut(true);
    const ok = await signOut();
    setSigningOut(false);
    if (ok) setOpen(false);
    else setSignOutError("Couldn't sign out. Check your connection and try again.");
  };

  if (loading) {
    return <span className={cn("inline-block h-4 w-12 rounded bg-secondary animate-pulse", className)} aria-hidden="true" />;
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => openSignIn()}
        className={cn("text-[13px] text-muted-foreground hover:text-foreground transition-colors rounded px-1", className)}
      >
        Sign in
      </button>
    );
  }

  const email = user.email ?? user.displayName ?? "Signed in";
  const initial = (user.displayName?.[0] ?? user.email?.[0] ?? "?").toUpperCase();
  const searchLimit = usage?.searchLimit ?? (searchQuota?.kind === "user" ? searchQuota.limit : 200);
  const explainLimit = usage?.explainLimit ?? (explainQuota?.kind === "user" ? explainQuota.limit : 100);
  const searchUsed = usage?.search ?? (searchQuota?.kind === "user" ? searchQuota.used : null);
  const explainUsed = usage?.explain ?? (explainQuota?.kind === "user" ? explainQuota.used : null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-2 rounded px-1 text-[13px] text-muted-foreground hover:text-foreground transition-colors",
            className,
          )}
          aria-label={`Account: ${email}`}
        >
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" width={24} height={24} className="h-6 w-6 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
              {initial}
            </span>
          )}
          {variant === "menu" && <span className="truncate max-w-[220px]">{email}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 rounded border-border">
        <div className="px-3 py-2.5 border-b border-border">
          <p className="text-[12px] text-muted-foreground">Signed in as</p>
          <p className="text-[13px] font-medium text-foreground truncate" title={email}>
            {email}
          </p>
        </div>
        <dl className="px-3 py-2.5 text-[12.5px] space-y-1">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">AI searches today</dt>
            <dd className="tabular text-foreground">
              <UsageValue used={searchUsed} limit={searchLimit} failed={usageFailed} />
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">AI explanations today</dt>
            <dd className="tabular text-foreground">
              <UsageValue used={explainUsed} limit={explainLimit} failed={usageFailed} />
            </dd>
          </div>
          <p className="pt-1 text-[11.5px] text-muted-foreground leading-snug">Counts reset at 00:00 UTC. Repeated questions are served from cache and don't count.</p>
        </dl>
        <div className="border-t border-border p-1.5 space-y-0.5">
          <Link to="/account" onClick={() => setOpen(false)} className="btn-ghost w-full justify-start">
            <UserRound size={14} />
            Account
          </Link>
          <Link to="/account#api-keys" onClick={() => setOpen(false)} className="btn-ghost w-full justify-start">
            <KeyRound size={14} />
            API keys
          </Link>
          <button type="button" onClick={() => void handleSignOut()} disabled={signingOut} className="btn-ghost w-full justify-start">
            {signingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
            Sign out
          </button>
          {signOutError && (
            <p role="alert" className="px-2 pb-1 text-[12px] leading-snug text-destructive">
              {signOutError}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default AccountMenu;

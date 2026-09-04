import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, LogOut, UserRound } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import { useAiQuota } from "@/lib/ai-quota";
import { useAuth } from "./AuthProvider";

export interface UsageToday {
  search: number;
  explain: number;
}

/** Today's counters straight from the database (the local copy can be stale on a new device). */
export function useUsageToday(enabled: boolean): UsageToday | null {
  const [usage, setUsage] = useState<UsageToday | null>(null);
  useEffect(() => {
    if (!enabled) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    import("@/integrations/supabase/client")
      .then(({ supabase }) => supabase.rpc("my_ai_usage_today"))
      .then(({ data }) => {
        if (cancelled) return;
        const out: UsageToday = { search: 0, explain: 0 };
        for (const row of (data ?? []) as { kind: string; used: number }[]) {
          if (row.kind === "search") out.search = row.used;
          if (row.kind === "explain") out.explain = row.used;
        }
        setUsage(out);
      })
      .catch(() => {
        if (!cancelled) setUsage({ search: 0, explain: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return usage;
}

/** Nav slot: "Sign in" when anonymous, a small account popover when signed in. */
export function AccountMenu({ className, variant = "nav" }: { className?: string; variant?: "nav" | "menu" }) {
  const { user, loading, signOut, openSignIn } = useAuth();
  const [open, setOpen] = useState(false);
  const usage = useUsageToday(open && !!user);
  const searchQuota = useAiQuota("search");
  const explainQuota = useAiQuota("explain");

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

  const email = user.email ?? "Signed in";
  const initial = (user.email?.[0] ?? "?").toUpperCase();
  const searchLimit = searchQuota?.kind === "user" ? searchQuota.limit : 200;
  const explainLimit = explainQuota?.kind === "user" ? explainQuota.limit : 100;
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
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {initial}
          </span>
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
              {searchUsed == null ? <span className="inline-block h-3 w-10 rounded bg-secondary animate-pulse" /> : `${fmtInt(searchUsed)} / ${fmtInt(searchLimit)}`}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">AI explanations today</dt>
            <dd className="tabular text-foreground">
              {explainUsed == null ? <span className="inline-block h-3 w-10 rounded bg-secondary animate-pulse" /> : `${fmtInt(explainUsed)} / ${fmtInt(explainLimit)}`}
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
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
            className="btn-ghost w-full justify-start"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default AccountMenu;

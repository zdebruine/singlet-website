import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiQuota, type AiQuota } from "@/lib/ai-quota";
import { useAuth } from "@/components/auth/AuthProvider";
import { apiClient } from "@/integrations/api/client";

/** Share of this month's AI token allowance left for the signed-in user, refreshed after each AI search. */
function useAllowanceLeft(signedIn: boolean, searchesSeen: number | undefined): { pct: number; renews: string | null } | null {
  const [left, setLeft] = useState<{ pct: number; renews: string | null } | null>(null);
  useEffect(() => {
    if (!signedIn) {
      setLeft(null);
      return;
    }
    const ctl = new AbortController();
    apiClient.auth
      .usage(ctl.signal)
      .then((u) => {
        const a = u.allowance;
        if (a && a.limit > 0) setLeft({ pct: Math.max(0, Math.round((100 * a.remaining) / a.limit)), renews: a.resetsAt });
      })
      .catch(() => undefined);
    return () => ctl.abort();
  }, [signedIn, searchesSeen]);
  return left;
}

/**
 * Small AI allowance indicator next to the interpretation chips. It speaks in
 * tokens (as a share of the month's allowance), never in money. Anonymous
 * visitors get the sign-in nudge.
 */
export function AiQuotaBadge({ className }: { className?: string }) {
  const quota = useAiQuota("search");
  const { user, openSignIn } = useAuth();
  const left = useAllowanceLeft(!!user, quota?.used);
  if (user) {
    if (!left) return null;
    return (
      <span
        className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap tabular", className)}
        title={`Your monthly AI token allowance${left.renews ? `, renews ${left.renews.slice(0, 10)}` : ""}. Repeated questions come from cache and use none. Billing for heavier use is coming.`}
      >
        AI allowance: <span className={cn("font-medium", left.pct <= 10 ? "text-warning" : "text-foreground/80")}>{left.pct}% left</span>
      </span>
    );
  }
  if (!quota) return null;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap tabular", className)}>
      <span title="The search box has a small free AI allowance. Repeated questions come from cache and use none.">Free AI search</span>
      <span aria-hidden="true">·</span>
      <button type="button" onClick={() => openSignIn()} className="text-ai hover:underline underline-offset-2">
        sign in for your own allowance
      </button>
    </span>
  );
}

/**
 * Shown verbatim above the results when the AI allowance is spent. The
 * results underneath come from the built-in vocabulary reading of the same words.
 */
export function AiQuotaExceeded({ quota, message }: { quota: AiQuota; message: string }) {
  const { user, openSignIn } = useAuth();
  const anon = quota.kind === "anon";
  return (
    <div className="warning-surface px-4 py-3 mb-3 flex flex-wrap items-start gap-x-4 gap-y-2" role="status">
      <Sparkles size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{message}</p>
        <p className="mt-0.5 text-[12px] opacity-80">Explicit filters in the rail and keyword search keep working without limit.</p>
      </div>
      {anon && !user && (
        <button type="button" onClick={() => openSignIn({ reason: "Signing in is free and gives you your own monthly AI allowance." })} className="btn-primary btn-sm shrink-0">
          Sign in for your own allowance
        </button>
      )}
    </div>
  );
}

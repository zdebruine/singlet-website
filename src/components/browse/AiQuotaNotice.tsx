import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtInt } from "@/lib/catalog-display";
import { resetsLabel, useAiQuota, type AiQuota } from "@/lib/ai-quota";
import { useAuth } from "@/components/auth/AuthProvider";

/**
 * Small "AI searches today: 3 / 10" counter shown next to the interpretation
 * chips. Anonymous visitors also get the sign-in nudge.
 */
export function AiQuotaBadge({ className }: { className?: string }) {
  const quota = useAiQuota("search");
  const { user, openSignIn } = useAuth();
  if (!quota) return null;
  const anon = quota.kind === "anon";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted-foreground whitespace-nowrap tabular", className)}>
      <span title={`Counts reset at 00:00 UTC (${resetsLabel(quota.resets_at)}). Repeated questions come from cache and don't count.`}>
        AI searches today: <span className={cn("font-medium", quota.used >= quota.limit ? "text-warning" : "text-foreground/80")}>{fmtInt(quota.used)}</span> / {fmtInt(quota.limit)}
      </span>
      {anon && !user && (
        <>
          <span aria-hidden="true">·</span>
          <button type="button" onClick={() => openSignIn()} className="text-ai hover:underline underline-offset-2">
            sign in for 200
          </button>
        </>
      )}
    </span>
  );
}

/**
 * Shown verbatim above the results when today's AI budget is spent. The
 * results underneath are a plain keyword search for the same words.
 */
export function AiQuotaExceeded({ quota, message }: { quota: AiQuota; message: string }) {
  const { user, openSignIn } = useAuth();
  const anon = quota.kind === "anon";
  return (
    <div className="warning-surface px-4 py-3 mb-3 flex flex-wrap items-start gap-x-4 gap-y-2" role="status">
      <Sparkles size={15} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-medium">{message}</p>
        <p className="mt-0.5 text-[12px] opacity-80">
          {fmtInt(quota.used)} of {fmtInt(quota.limit)} used · {resetsLabel(quota.resets_at)}. Explicit filters in the rail and keyword search keep working without limit.
        </p>
      </div>
      {anon && !user && (
        <button type="button" onClick={() => openSignIn({ reason: "Signing in is free and raises the limit to 200 AI searches a day." })} className="btn-primary btn-sm shrink-0">
          Sign in for 200 a day
        </button>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Plug, Unplug } from "lucide-react";
import { apiClient, isApiError } from "@/integrations/api/client";
import type { ConnectionSummary } from "@/integrations/api/types";
import { MCP_URL } from "@/lib/mcp-snippets";

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * /account: how to add singlet to Claude as a connector (sign-in, no key), and the MCP clients the
 * user connected that way, each of which can be disconnected.
 */
export function ConnectedApps({ userId, onUnauthorized }: { userId: string; onUnauthorized: () => Promise<void> | void }) {
  const [items, setItems] = useState<ConnectionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await apiClient.connections.list());
    } catch (e) {
      setItems([]);
      setError(isApiError(e) ? e.message : "Could not load your connected apps.");
      if (isApiError(e) && e.status === 401) void onUnauthorized();
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void load();
  }, [userId, load]);

  const disconnect = async (id: string) => {
    setBusy(id);
    try {
      await apiClient.connections.revoke(id);
      setItems((prev) => (prev ?? []).filter((c) => c.id !== id));
    } catch (e) {
      setError(isApiError(e) ? e.message : "Could not disconnect it right now.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="connectors" className="surface p-5 scroll-mt-24" aria-labelledby="connectors-h">
      <h2 id="connectors-h" className="text-[15px] font-semibold text-foreground inline-flex items-center gap-2">
        <Plug size={16} className="text-primary" aria-hidden="true" />
        Add to Claude
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        In Claude (web, Desktop or mobile): <span className="text-foreground">Settings → Connectors → Add custom connector</span>, paste{" "}
        <code className="code-inline">{MCP_URL}</code>, then sign in here when Claude asks. No API key needed. Claude Code, Cursor and other MCP
        clients connect the same way.{" "}
        <Link to="/docs/mcp" className="text-primary hover:underline">
          MCP docs →
        </Link>
      </p>

      <div className="mt-4">
        <h3 className="text-[12.5px] font-medium text-foreground">Connected apps</h3>
        {items === null ? (
          <div className="mt-2 h-9 rounded bg-secondary animate-pulse" aria-hidden="true" />
        ) : items.length === 0 ? (
          <p className="mt-1 text-[13px] text-muted-foreground">None yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {items.map((c) => (
              <li key={c.id} className="py-2.5 flex items-center justify-between gap-3 text-[13px]">
                <span>
                  <span className="font-medium text-foreground">{c.client_name ?? "MCP client"}</span>
                  <span className="ml-2 text-muted-foreground">
                    connected {fmtWhen(c.created_at)} · last used {fmtWhen(c.last_used_at)}
                  </span>
                </span>
                <button type="button" className="btn-ghost btn-sm shrink-0" onClick={() => void disconnect(c.id)} disabled={busy === c.id}>
                  {busy === c.id ? <Loader2 size={13} className="animate-spin" /> : <Unplug size={13} />}
                  Disconnect
                </button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-2 text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

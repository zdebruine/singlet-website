import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Folder, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Library } from "@/integrations/api/types";
import { useLibraries } from "./useLibraries";

/** A library opens as a Browse search for its accessions. */
export function libraryHref(l: Library): string {
  return `/browse?q=${encodeURIComponent(l.gse_ids.join(" "))}`;
}

function Row({ lib, active, onOpen }: { lib: Library; active: boolean; onOpen: () => void }) {
  const { rename, remove } = useLibraries();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(lib.name);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const save = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || n === lib.name) {
      setEditing(false);
      setName(lib.name);
      return;
    }
    rename.mutate({ id: lib.id, name: n }, { onSuccess: () => setEditing(false), onError: (err) => setError(err instanceof Error ? err.message : "Could not rename.") });
  };

  if (editing) {
    return (
      <li>
        <form onSubmit={save} className="flex items-center gap-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            aria-label={`Rename ${lib.name}`}
            className="input h-7 flex-1 min-w-0 text-[13px] px-2"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setEditing(false);
                setName(lib.name);
              }
            }}
          />
          <button type="submit" className="p-1 text-primary" aria-label="Save name" disabled={rename.isPending}>
            <Check size={14} />
          </button>
          <button type="button" className="p-1 text-muted-foreground" aria-label="Cancel" onClick={() => { setEditing(false); setName(lib.name); }}>
            <X size={14} />
          </button>
        </form>
        {error && <p role="alert" className="text-[11.5px] text-destructive">{error}</p>}
      </li>
    );
  }

  return (
    <li className="group flex items-center gap-1.5 rounded-sm hover:bg-secondary/60">
      <button
        type="button"
        onClick={onOpen}
        disabled={lib.gse_ids.length === 0}
        className={cn("flex-1 min-w-0 flex items-center gap-2 py-1 px-1.5 text-left text-[13px] disabled:opacity-60", active && "font-medium text-foreground")}
        title={lib.gse_ids.length ? `Open ${lib.name}` : "Empty library"}
      >
        <Folder size={14} className="shrink-0 text-muted-foreground" />
        <span className="truncate flex-1">{lib.name}</span>
        <span className="text-[11px] text-muted-foreground tabular">{lib.gse_ids.length}</span>
      </button>
      {confirming ? (
        <span className="flex items-center gap-1 pr-1 text-[11.5px]">
          <button type="button" className="text-destructive font-medium" onClick={() => remove.mutate(lib.id)} disabled={remove.isPending}>
            Delete
          </button>
          <button type="button" className="text-muted-foreground" onClick={() => setConfirming(false)}>
            Keep
          </button>
        </span>
      ) : (
        <span className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity pr-1">
          <button type="button" className="p-1 text-muted-foreground hover:text-foreground" aria-label={`Rename ${lib.name}`} title="Rename" onClick={() => setEditing(true)}>
            <Pencil size={12} />
          </button>
          <button type="button" className="p-1 text-muted-foreground hover:text-destructive" aria-label={`Delete ${lib.name}`} title="Delete" onClick={() => setConfirming(true)}>
            <Trash2 size={12} />
          </button>
        </span>
      )}
    </li>
  );
}

/** The user's libraries as folders at the top of the Browse sidebar. Hidden when signed out or when there are none. */
export function LibrarySection({ currentQuery }: { currentQuery: string }) {
  const { signedIn, libraries } = useLibraries();
  const navigate = useNavigate();
  if (!signedIn || libraries.length === 0) return null;
  return (
    <section className="py-4 border-b border-border" aria-label="Library">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2">Library</h3>
      <ul className="space-y-0.5">
        {libraries.map((l) => (
          <Row key={l.id} lib={l} active={currentQuery.trim() !== "" && currentQuery.trim() === l.gse_ids.join(" ")} onOpen={() => navigate(libraryHref(l))} />
        ))}
      </ul>
    </section>
  );
}

import { useState, type FormEvent } from "react";
import { Check, FolderPlus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useLibraries } from "./useLibraries";

interface Props {
  /** Studies to add (one on a study page, the selection in Browse). */
  gseIds: string[];
  /** Text next to the icon; omit for an icon-only button. */
  label?: string;
  className?: string;
  disabled?: boolean;
}

/** Add studies to one of the user's libraries, or to a new one. Clicking a library that already holds them removes them. */
export function AddToLibraryMenu({ gseIds, label, className, disabled }: Props) {
  const { signedIn, libraries, add, removeItems, create, requireSignIn } = useLibraries();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const busy = add.isPending || removeItems.isPending || create.isPending;

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : "That did not work. Try again.");

  const toggle = (id: string, has: boolean) => {
    setError("");
    (has ? removeItems : add).mutate({ id, gseIds }, { onError: fail });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setError("");
    create.mutate({ name: n, gseIds }, { onSuccess: () => setName(""), onError: fail });
  };

  const trigger = (
    <button
      type="button"
      disabled={disabled || gseIds.length === 0}
      className={cn("btn-secondary btn-sm", className)}
      aria-label="Add to library"
      title="Add to library"
      onClick={signedIn ? undefined : () => requireSignIn(() => undefined)}
    >
      <FolderPlus size={14} />
      {label && <span>{label}</span>}
    </button>
  );
  if (!signedIn) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[12px] text-muted-foreground font-normal">
          {gseIds.length === 1 ? `Add ${gseIds[0]} to` : `Add ${gseIds.length} studies to`}
        </DropdownMenuLabel>
        {libraries.length === 0 && <p className="px-2 py-1.5 text-[12.5px] text-muted-foreground">No libraries yet. Name one below.</p>}
        <div className="max-h-56 overflow-y-auto">
          {libraries.map((l) => {
            const has = gseIds.length > 0 && gseIds.every((g) => l.gse_ids.includes(g));
            return (
              <button
                key={l.id}
                type="button"
                disabled={busy}
                onClick={() => toggle(l.id, has)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-[13px] rounded-sm hover:bg-secondary disabled:opacity-60"
              >
                <span className="w-4 shrink-0">{has && <Check size={14} className="text-primary" />}</span>
                <span className="truncate flex-1">{l.name}</span>
                <span className="text-[11px] text-muted-foreground tabular">{l.gse_ids.length}</span>
              </button>
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <form onSubmit={submit} className="p-1.5 flex items-center gap-1.5" onKeyDown={(e) => e.stopPropagation()}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="New library"
            aria-label="New library name"
            className="input h-8 flex-1 min-w-0 text-[13px]"
          />
          <button type="submit" className="btn-secondary btn-sm" disabled={busy || !name.trim()} aria-label="Create library and add">
            <Plus size={14} />
          </button>
        </form>
        {error && <p role="alert" className="px-2 pb-1.5 text-[12px] text-destructive">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

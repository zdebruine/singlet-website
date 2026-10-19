import { useCallback, useState } from "react";
import { Columns3 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** One table column. `required` columns are always shown and not listed in the menu. */
export interface ColumnDef<T> {
  key: string;
  label: string;
  /** Shown until the visitor changes it. */
  default: boolean;
  required?: boolean;
  align?: "right";
  /** Tailwind width class for the column. */
  width?: string;
  render: (row: T) => React.ReactNode;
}

function readPrefs(storageKey: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

/** Which columns are visible, remembered per browser. Unknown stored keys are ignored. */
export function useColumnVisibility<T>(storageKey: string, defs: ColumnDef<T>[]) {
  const defaults = defs.filter((d) => d.default || d.required).map((d) => d.key);
  const [keys, setKeys] = useState<string[]>(() => {
    const stored = readPrefs(storageKey);
    return stored ? defs.filter((d) => d.required || stored.includes(d.key)).map((d) => d.key) : defaults;
  });
  const save = useCallback(
    (next: string[]) => {
      setKeys(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* storage blocked: the choice lasts for this page view */
      }
    },
    [storageKey]
  );
  const toggle = (key: string) => save(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
  const reset = () => save(defaults);
  const visible = defs.filter((d) => d.required || keys.includes(d.key));
  return { visible, keys, toggle, reset };
}

/** "Columns" button with a checklist of the optional columns. */
export function ColumnsMenu<T>({
  defs,
  keys,
  onToggle,
  onReset,
}: {
  defs: ColumnDef<T>[];
  keys: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn-secondary btn-sm" aria-label="Show or hide columns" title="Show or hide columns">
          <Columns3 size={14} />
          <span className="hidden sm:inline">Columns</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {defs
          .filter((d) => !d.required)
          .map((d) => (
            <DropdownMenuCheckboxItem
              key={d.key}
              checked={keys.includes(d.key)}
              onCheckedChange={() => onToggle(d.key)}
              onSelect={(e) => e.preventDefault()}
            >
              {d.label}
            </DropdownMenuCheckboxItem>
          ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onReset}>Reset to default</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchDestination } from "@/lib/search-routing";

/** The one placeholder used by every search input on the site. */
export const SEARCH_PLACEHOLDER = "Describe what you're looking for — a tissue, disease, cell type, organism, or a GSE accession";

/**
 * Site search. There is exactly one search input per page; this component
 * renders it in two sizes:
 *  - "hero": the home page box (1.5px teal border, attached gradient button)
 *  - "compact": the header input on pages that have no search of their own
 * Everything typed here is sent to the same AI-interpreted search (/browse?q=…);
 * accessions go straight to the study.
 */
export function SearchBox({
  variant = "compact",
  initialValue = "",
  placeholder,
  className,
  autoFocus,
  onSubmitted,
  id,
}: {
  variant?: "hero" | "compact";
  initialValue?: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onSubmitted?: (text: string) => void;
  /** Override the input id when two compact boxes could be mounted at once (desktop + open mobile menu). */
  id?: string;
}) {
  const inputId = id ?? (variant === "hero" ? "hero-search" : "site-search");
  const navigate = useNavigate();
  const [value, setValue] = useState(initialValue);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const dest = searchDestination(value);
    if (!dest) return;
    onSubmitted?.(value.trim());
    navigate(dest);
  };

  if (variant === "hero") {
    return (
      <form onSubmit={submit} role="search" className={cn("w-full", className)}>
        <div
          className="flex items-stretch bg-card rounded overflow-hidden"
          style={{ border: "1.5px solid #0E8C7E" }}
        >
          <label htmlFor={inputId} className="sr-only">
            Search the atlas
          </label>
          <input
            id={inputId}
            type="search"
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder ?? SEARCH_PLACEHOLDER}
            className="flex-1 min-w-0 bg-transparent px-4 h-[52px] text-[15px] text-foreground placeholder:text-muted-foreground focus:outline-none [&::-webkit-search-cancel-button]:appearance-none"
          />
          <button
            type="submit"
            className="btn-primary h-auto rounded-none px-6 text-[15px] shrink-0 border-0"
            aria-label="Search"
          >
            <Search size={16} />
            <span>Search</span>
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submit} role="search" className={cn("relative", className)}>
      <label htmlFor={inputId} className="sr-only">
        Search the atlas
      </label>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        id={inputId}
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? SEARCH_PLACEHOLDER}
        title={SEARCH_PLACEHOLDER}
        className="input h-9 pl-8 pr-3 text-[13px] [&::-webkit-search-cancel-button]:appearance-none"
      />
    </form>
  );
}

export default SearchBox;

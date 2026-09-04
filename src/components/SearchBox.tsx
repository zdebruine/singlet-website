import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { searchDestination } from "@/lib/search-routing";

/**
 * Site search. Two sizes:
 *  - "hero": the home page box (1.5px teal border, attached gradient button)
 *  - "compact": the header input on every other page
 * Submitting navigates via `searchDestination` (accessions go straight to a study).
 */
export function SearchBox({
  variant = "compact",
  initialValue = "",
  placeholder,
  className,
  autoFocus,
  onSubmitted,
}: {
  variant?: "hero" | "compact";
  initialValue?: string;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onSubmitted?: (text: string) => void;
}) {
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
          <label htmlFor="hero-search" className="sr-only">
            Search the atlas
          </label>
          <input
            id="hero-search"
            type="search"
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder ?? "Describe what you're looking for — a tissue, disease, cell type, organism…"}
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
      <label htmlFor="site-search" className="sr-only">
        Search the atlas
      </label>
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        id="site-search"
        type="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? "Search studies, GSE, GSM…"}
        className="input h-9 pl-8 pr-3 text-[13px] [&::-webkit-search-cancel-button]:appearance-none"
      />
    </form>
  );
}

export default SearchBox;

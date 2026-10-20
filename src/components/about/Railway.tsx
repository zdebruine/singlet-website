import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A vertical railway down the page. Each station is a claim, a small visual, an optional "read more" and a link
 * to the docs. The station nearest the middle of the screen is active (filled node, full colour); the rest dim.
 * Hovering a node brings its station to the middle, and the page snaps gently between stations.
 */

interface RailState {
  active: string | null;
  register: (id: string, el: HTMLElement) => () => void;
}

const RailCtx = createContext<RailState>({ active: null, register: () => () => undefined });

const reduceMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Railway({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const els = useRef(new Map<string, HTMLElement>());
  const wrap = useRef<HTMLDivElement>(null);

  // Gentle snapping while this page is open.
  useEffect(() => {
    if (reduceMotion()) return;
    const root = document.documentElement;
    const prev = root.style.scrollSnapType;
    root.style.scrollSnapType = "y proximity";
    return () => {
      root.style.scrollSnapType = prev;
    };
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const mid = window.innerHeight / 2;
      let best: string | null = null;
      let bestD = Infinity;
      els.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - mid);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      });
      setActive(best);
      const w = wrap.current?.getBoundingClientRect();
      if (w) setProgress(Math.min(1, Math.max(0, (mid - w.top) / Math.max(1, w.height))));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const register = (id: string, el: HTMLElement) => {
    els.current.set(id, el);
    return () => {
      els.current.delete(id);
    };
  };

  return (
    <RailCtx.Provider value={{ active, register }}>
      <div ref={wrap} className="relative">
        <span aria-hidden="true" className="absolute left-[19px] md:left-[27px] top-0 bottom-0 w-[3px] rounded bg-[var(--teal-100)]" />
        <span
          aria-hidden="true"
          className="absolute left-[19px] md:left-[27px] top-0 w-[3px] rounded bg-primary"
          style={{ height: `${progress * 100}%` }}
        />
        <ol>{children}</ol>
      </div>
    </RailCtx.Provider>
  );
}

export function Station({
  id,
  n,
  title,
  claim,
  visual,
  more,
  link,
  defaultOpen = false,
}: {
  id: string;
  n: number;
  title: string;
  /** One sentence. */
  claim: ReactNode;
  visual: ReactNode;
  /** Shown after "Read more". */
  more?: ReactNode;
  link?: { to: string; label: string };
  defaultOpen?: boolean;
}) {
  const { active, register } = useContext(RailCtx);
  const ref = useRef<HTMLLIElement>(null);
  const [open, setOpen] = useState(defaultOpen);
  const on = active === id;

  useEffect(() => {
    if (ref.current) return register(id, ref.current);
  }, [id, register]);
  useEffect(() => setOpen((o) => o || defaultOpen), [defaultOpen]);

  const focus = () => {
    if (on || reduceMotion()) return;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <li
      ref={ref}
      id={id}
      className="relative pl-14 md:pl-24 py-10 md:py-14 scroll-mt-24 [scroll-snap-align:center] min-h-[60vh] flex items-center"
    >
      <button
        type="button"
        onMouseEnter={focus}
        onFocus={focus}
        onClick={focus}
        aria-label={`${n}. ${title}`}
        className={cn(
          "absolute left-0 md:left-2 top-1/2 -translate-y-1/2 grid place-items-center h-10 w-10 md:h-12 md:w-12 rounded-full border-[3px] font-mono text-[14px] font-semibold transition-all duration-300",
          on ? "bg-primary border-primary text-primary-foreground scale-110 shadow-[0_0_0_8px_rgba(14,140,126,0.12)]" : "bg-card border-[var(--teal-200)] text-muted-foreground hover:border-primary"
        )}
      >
        {n}
      </button>

      <div className={cn("w-full grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8 lg:gap-12 items-center transition-opacity duration-500", on ? "opacity-100" : "opacity-45")}>
        <div className="min-w-0">
          <h2 className="text-[26px] md:text-[32px] leading-tight font-semibold tracking-tight">{title}</h2>
          <p className="mt-3 text-[16.5px] leading-relaxed text-muted-foreground max-w-[520px]">{claim}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px]">
            {more && (
              <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary">
                {open ? "Show less" : "Read more"}
                <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
              </button>
            )}
            {link && (
              <Link to={link.to} className="inline-flex items-center gap-1 text-primary hover:underline">
                {link.label} <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </div>
          {more && open && <div className="mt-4 space-y-2.5 text-[14.5px] leading-relaxed max-w-[560px]">{more}</div>}
        </div>
        <div className="min-w-0 surface p-5 md:p-6">{visual}</div>
      </div>
    </li>
  );
}

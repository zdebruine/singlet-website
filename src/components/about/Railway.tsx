import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A vertical railway down the page. Each station is a claim, a small visual, a few lines of detail and a link to
 * the docs. The rail fills as you scroll and the node of the station in view turns solid. Nothing moves the page.
 */

interface RailState {
  active: string | null;
  register: (id: string, el: HTMLElement) => () => void;
}

const RailCtx = createContext<RailState>({ active: null, register: () => () => undefined });

export function Railway({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const els = useRef(new Map<string, HTMLElement>());
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const mid = window.innerHeight * 0.55;
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
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const register = useRef((id: string, el: HTMLElement) => {
    els.current.set(id, el);
    return () => {
      els.current.delete(id);
    };
  }).current;

  return (
    <RailCtx.Provider value={{ active, register }}>
      <div ref={wrap} className="relative">
        <span aria-hidden="true" className="absolute left-[19px] md:left-[23px] top-0 bottom-0 w-[2px] rounded bg-[var(--teal-100)]" />
        <span aria-hidden="true" className="absolute left-[19px] md:left-[23px] top-0 w-[2px] rounded bg-primary" style={{ height: `${progress * 100}%` }} />
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
  detail,
  link,
}: {
  id: string;
  n: number;
  title: string;
  /** One sentence. */
  claim: ReactNode;
  visual: ReactNode;
  /** Two or three short lines for the curious reader. */
  detail?: ReactNode;
  link?: { to: string; label: string };
}) {
  const { active, register } = useContext(RailCtx);
  const ref = useRef<HTMLLIElement>(null);
  const on = active === id;

  useEffect(() => {
    if (ref.current) return register(id, ref.current);
  }, [id, register]);

  return (
    <li ref={ref} id={id} className="relative pl-14 md:pl-20 py-12 md:py-16 scroll-mt-24">
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-12 md:top-16 grid place-items-center h-10 w-10 md:h-12 md:w-12 -ml-0 md:-ml-0 rounded-full border-2 font-mono text-[14px] font-semibold transition-colors duration-500",
          on ? "bg-primary border-primary text-primary-foreground" : "bg-card border-[var(--teal-200)] text-muted-foreground"
        )}
      >
        {n}
      </span>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8 lg:gap-14 items-start">
        <div className="min-w-0 pt-1 md:pt-2">
          <h2 className="text-[26px] md:text-[32px] leading-tight font-semibold tracking-tight">{title}</h2>
          <p className="mt-3 text-[17px] leading-relaxed text-foreground/85 max-w-[540px]">{claim}</p>
          {detail && <div className="mt-4 space-y-2 text-[14px] leading-relaxed text-muted-foreground max-w-[540px]">{detail}</div>}
          {link && (
            <Link to={link.to} className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-medium text-primary hover:underline">
              {link.label} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          )}
        </div>
        <div className="min-w-0 surface p-5 md:p-6 shadow-[0_10px_30px_-18px_rgba(15,31,29,0.35)]">{visual}</div>
      </div>
    </li>
  );
}

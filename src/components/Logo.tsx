import { useId } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * singlet.bio logo — mark + wordmark.
 *
 * Mark: a 4×4 lattice of cells; one cell is "lit" (teal→cyan gradient, slightly
 * larger) and connected by thin gradient edges to its four neighbours — a single
 * cell in a population / a kNN graph.
 *
 * Wordmark: "singlet" in Space Grotesk 700 (ink), ".bio" in the same face with the
 * teal→cyan gradient as text fill.
 *
 * `size` is the wordmark height in px; the mark is 1.15× that.
 */
export interface LogoProps {
  size?: number;
  variant?: "light" | "dark";
  /** Render only the lattice mark. */
  markOnly?: boolean;
  /** Wrap in a link to "/" (default true). */
  link?: boolean;
  className?: string;
}

const PALETTE = {
  light: { cell: "#B7C6C2", neighbour: "#7FBDB4", word: "#0F1F1D" },
  dark: { cell: "#3A5C57", neighbour: "#4E8F86", word: "#EAF4F1" },
} as const;

export function LogoMark({
  size = 24,
  variant = "light",
  className,
}: {
  size?: number;
  variant?: "light" | "dark";
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const gid = `singlet-g-${id}`;
  const p = PALETTE[variant];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0E8C7E" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="6" height="6" fill={p.cell} />
      <rect x="12" y="2" width="6" height="6" fill={p.cell} />
      <rect x="22" y="2" width="6" height="6" fill={p.cell} />
      <rect x="32" y="2" width="6" height="6" fill={p.cell} />
      <rect x="2" y="12" width="6" height="6" fill={p.neighbour} />
      <rect x="12" y="12" width="6" height="6" fill={p.neighbour} />
      <rect x="22" y="12" width="6" height="6" fill={p.cell} />
      <rect x="32" y="12" width="6" height="6" fill={p.cell} />
      <rect x="2" y="22" width="6" height="6" fill={p.cell} />
      <rect x="22" y="22" width="6" height="6" fill={p.neighbour} />
      <rect x="32" y="22" width="6" height="6" fill={p.cell} />
      <rect x="2" y="32" width="6" height="6" fill={p.cell} />
      <rect x="12" y="32" width="6" height="6" fill={p.neighbour} />
      <rect x="22" y="32" width="6" height="6" fill={p.cell} />
      <rect x="32" y="32" width="6" height="6" fill={p.cell} />
      <line x1="15" y1="25" x2="5" y2="15" stroke={`url(#${gid})`} strokeWidth="1.2" strokeOpacity="0.9" />
      <line x1="15" y1="25" x2="15" y2="15" stroke={`url(#${gid})`} strokeWidth="1.2" strokeOpacity="0.9" />
      <line x1="15" y1="25" x2="15" y2="35" stroke={`url(#${gid})`} strokeWidth="1.2" strokeOpacity="0.9" />
      <line x1="15" y1="25" x2="25" y2="25" stroke={`url(#${gid})`} strokeWidth="1.2" strokeOpacity="0.9" />
      <rect x="11" y="21" width="8" height="8" fill={`url(#${gid})`} />
    </svg>
  );
}

export function Logo({ size = 22, variant = "light", markOnly = false, link = true, className }: LogoProps) {
  const p = PALETTE[variant];
  const markSize = Math.round(size * 1.15);
  const content = (
    <span className={cn("inline-flex items-center gap-2 select-none", className)} aria-label="singlet.bio">
      <LogoMark size={markSize} variant={variant} />
      {!markOnly && (
        <span
          className="font-display font-bold leading-none whitespace-nowrap"
          style={{ fontSize: size, letterSpacing: "-0.04em", lineHeight: 1 }}
        >
          <span style={{ color: p.word }}>singlet</span>
          <span className="gradient-text">.bio</span>
        </span>
      )}
    </span>
  );
  if (!link) return content;
  return (
    <Link to="/" className="inline-flex items-center rounded focus-visible:outline-offset-4" aria-label="singlet.bio home">
      {content}
    </Link>
  );
}

export default Logo;

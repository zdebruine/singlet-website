import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

export interface LogoProps {
  variant?: "mark" | "wordmark" | "lockup" | "stacked";
  theme?: "auto" | "light" | "dark" | "mono";
  height?: number;
  link?: boolean;
  className?: string;
}

function Mark({ theme }: { theme: NonNullable<LogoProps["theme"]> }) {
  return (
    <g className={cn("logo-mark", `logo-${theme}`)}>
      {Array.from({ length: 16 }, (_, i) => {
        const row = Math.floor(i / 4);
        const col = i % 4;
        const lit = row === 1 && col === 2;
        return <rect key={i} x={col * 27} y={row * 27} width="19" height="19" rx="2" className={lit ? "logo-lit" : "logo-cell"} />;
      })}
    </g>
  );
}

function Wordmark({ theme }: { theme: NonNullable<LogoProps["theme"]> }) {
  return (
    <text x="0" y="75" className={cn("logo-word", `logo-${theme}`)}>
      <tspan>singlet</tspan><tspan className="logo-bio">.bio</tspan>
    </text>
  );
}

export function Logo({ variant = "lockup", theme = "auto", height = 24, link = true, className }: LogoProps) {
  const viewBox = variant === "mark" ? "0 0 100 100" : variant === "wordmark" ? "0 0 465 100" : variant === "stacked" ? "0 0 505 270" : "0 0 449 100";
  const content = (
    <svg viewBox={viewBox} height={height} className={cn("singlet-logo shrink-0", className)} role="img" aria-label="singlet.bio">
      {variant === "mark" && <Mark theme={theme} />}
      {variant === "wordmark" && <Wordmark theme={theme} />}
      {variant === "lockup" && <><g transform="translate(0 14) scale(.72)"><Mark theme={theme} /></g><g transform="translate(86 8) scale(.78)"><Wordmark theme={theme} /></g></>}
      {variant === "stacked" && <><g transform="translate(202.5 20)"><Mark theme={theme} /></g><g transform="translate(43 140) scale(.9)"><Wordmark theme={theme} /></g></>}
    </svg>
  );
  if (!link) return content;
  return <Link to="/" className="inline-flex items-center" aria-label="singlet.bio home">{content}</Link>;
}

export function LogoMark({ size = 24, theme = "auto", className }: { size?: number; theme?: LogoProps["theme"]; className?: string }) {
  return <Logo variant="mark" theme={theme} height={size} link={false} className={className} />;
}

export default Logo;

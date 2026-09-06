import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { LOGO_SVGS } from "@/generated/logo-svg";

export interface LogoProps {
  variant?: "mark" | "wordmark" | "lockup" | "stacked";
  theme?: "auto" | "light" | "dark" | "mono";
  height?: number;
  link?: boolean;
  className?: string;
}

type LogoKey = keyof typeof LOGO_SVGS;

function outlinedSvg(variant: NonNullable<LogoProps["variant"]>, mode: "light" | "dark" | "mono") {
  const suffix = mode === "mono" ? "mono-ink" : mode;
  const exact = `singlet-${variant}-${suffix}` as LogoKey;
  if (exact in LOGO_SVGS) return LOGO_SVGS[exact];
  const fallback = `singlet-${variant}-light` as LogoKey;
  return LOGO_SVGS[fallback];
}

function SvgImage({ variant, mode, height, className }: { variant: NonNullable<LogoProps["variant"]>; mode: "light" | "dark" | "mono"; height: number; className?: string }) {
  return <span className={cn("outlined-logo", className)} style={{ height }} aria-label="singlet.bio" role="img" dangerouslySetInnerHTML={{ __html: outlinedSvg(variant, mode) }} />;
}

export function Logo({ variant = "lockup", theme = "auto", height = 24, link = true, className }: LogoProps) {
  const content = theme === "auto" ? (
    <span className={cn("inline-flex", className)}>
      <SvgImage variant={variant} mode="light" height={height} className="logo-auto-light" />
      <SvgImage variant={variant} mode="dark" height={height} className="logo-auto-dark" />
    </span>
  ) : <SvgImage variant={variant} mode={theme} height={height} className={className} />;
  if (!link) return content;
  return <Link to="/" className="inline-flex items-center" aria-label="singlet.bio home">{content}</Link>;
}

export function LogoMark({ size = 24, theme = "auto", className }: { size?: number; theme?: LogoProps["theme"]; className?: string }) {
  return <Logo variant="mark" theme={theme} height={size} link={false} className={className} />;
}

export default Logo;

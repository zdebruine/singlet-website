/**
 * Which channel this build serves. Alpha (singlet.bio) and Research Beta (beta.singlet.bio) share one codebase; a Beta build sets
 * VITE_CHANNEL=beta (and VITE_DATA_BASE=https://beta-data.singlet.bio), see docs/BETA-CHANNEL.md. Copy that differs between the
 * channels reads IS_BETA, so an Alpha build renders exactly as before.
 */
import { DATA_BASE } from "./install-snippets";

const flag = String((import.meta.env?.VITE_CHANNEL as string | undefined) ?? "").trim().toLowerCase();

export const IS_BETA: boolean = flag === "beta" || (flag === "" && /beta-data\./.test(DATA_BASE));

/** Engine release Beta is reprocessed with (the campaign accepts both builds). */
export const BETA_ENGINE = "singlet 1.4";

/** Alpha's site, where Alpha keeps serving until the cutover (docs/BETA_CUTOVER_PLAN.md in singlet-agents). */
export const ALPHA_SITE = "https://singlet.bio";

/** This build's own site origin: API, MCP and page links in docs and snippets name it. */
export const SITE_BASE = IS_BETA ? "https://beta.singlet.bio" : "https://singlet.bio";

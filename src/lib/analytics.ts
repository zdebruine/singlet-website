/**
 * Product analytics: PostHog Cloud (US), sent first-party through the
 * /relay Pages Function (functions/relay/[[path]].ts) so ad blockers that
 * block posthog.com do not hide traffic, and the site's CSP stays 'self'.
 *
 * Captures page views on every client-side route change, page leaves (time on
 * page and scroll depth), clicks (autocapture), referrers and UTM tags, and
 * heatmaps. No session recordings. Signed-in visitors are identified by their
 * account id only, never their email, so return visits on other devices count
 * as the same person. Runs on the production hosts only: local dev and
 * *.pages.dev previews send nothing, nor do browsers set to Do Not Track.
 * Described in /privacy section 10.
 */
import posthog from "posthog-js";

/** PostHog project API key. Public by design (it can only send events). Empty disables analytics. */
export const POSTHOG_KEY = "";

const PRODUCTION_HOSTS = new Set(["singlet.bio", "www.singlet.bio"]);

let enabled = false;

export function initAnalytics(): void {
  if (!POSTHOG_KEY || !PRODUCTION_HOSTS.has(window.location.hostname)) return;
  posthog.init(POSTHOG_KEY, {
    api_host: "/relay",
    ui_host: "https://us.posthog.com",
    person_profiles: "always",
    capture_pageview: "history_change",
    capture_pageleave: true,
    autocapture: true,
    enable_heatmaps: true,
    disable_session_recording: true,
    disable_surveys: true,
    respect_dnt: true,
  });
  enabled = true;
}

/** Link this browser's visits to a signed-in account. */
export function identifyUser(accountId: string): void {
  if (enabled && posthog.get_distinct_id() !== accountId) posthog.identify(accountId);
}

/** After sign-out: start a new anonymous visitor so the next person on this browser is not merged in. */
export function resetUser(): void {
  if (enabled) posthog.reset();
}

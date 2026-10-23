/**
 * GET /oauth/consent?request=… — sign in (GitHub/Google), then "Allow <client> to use singlet
 * tools as you". POST — the Allow/Cancel form; redirects back to the client with a code.
 * See ../_shared/mcp-oauth.ts.
 */
import type { AppEnv } from "../_shared/env";
import { consentDecision, consentPage } from "../_shared/mcp-oauth";

export const onRequestGet: PagesFunction<AppEnv> = ({ request, env, waitUntil }) => consentPage(request, env, waitUntil);
export const onRequestPost: PagesFunction<AppEnv> = ({ request, env, waitUntil }) => consentDecision(request, env, waitUntil);

/**
 * GET /auth/google/start?return_to=/path — begin "Continue with Google".
 * Stores a one-time state + PKCE verifier in D1 and redirects to Google.
 * See ../../_shared/oauth.ts for the whole flow.
 */
import type { AppEnv } from "../../_shared/env";
import { startSignIn } from "../../_shared/oauth";

export const onRequestGet: PagesFunction<AppEnv> = ({ request, env, waitUntil }) => startSignIn(request, env, "google", waitUntil);

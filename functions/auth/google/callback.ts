/**
 * GET /auth/google/callback — the authorized redirect URI registered on the
 * Google OAuth client (https://singlet.bio/auth/google/callback). Relays
 * attempts that began on a preview or local host back to it; otherwise
 * exchanges the code, signs the visitor in and redirects to where they
 * started. See ../../_shared/oauth.ts for the whole flow.
 */
import type { AppEnv } from "../../_shared/env";
import { finishSignIn } from "../../_shared/oauth";

export const onRequestGet: PagesFunction<AppEnv> = ({ request, env }) => finishSignIn(request, env, "google");

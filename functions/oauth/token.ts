/**
 * POST /oauth/token — authorization_code (PKCE S256) and refresh_token grants for MCP clients.
 * See ../_shared/mcp-oauth.ts.
 */
import type { AppEnv } from "../_shared/env";
import { token } from "../_shared/mcp-oauth";

export const onRequest: PagesFunction<AppEnv> = ({ request, env, waitUntil }) => token(request, env, waitUntil);

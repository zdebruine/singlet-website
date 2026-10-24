/**
 * GET /oauth/authorize — start of the MCP sign-in: checks the client, redirect_uri and PKCE
 * challenge, then sends the browser to /oauth/consent. See ../_shared/mcp-oauth.ts.
 */
import type { AppEnv } from "../_shared/env";
import { authorize } from "../_shared/mcp-oauth";

export const onRequestGet: PagesFunction<AppEnv> = ({ request, env, waitUntil }) => authorize(request, env, waitUntil);

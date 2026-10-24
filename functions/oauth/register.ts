/**
 * POST /oauth/register — dynamic client registration (RFC 7591) for MCP clients such as Claude's
 * custom connectors. See ../_shared/mcp-oauth.ts for the whole flow.
 */
import type { AppEnv } from "../_shared/env";
import { register } from "../_shared/mcp-oauth";

export const onRequest: PagesFunction<AppEnv> = ({ request, env }) => register(request, env);

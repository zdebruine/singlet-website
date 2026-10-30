/**
 * https://singlet.bio/mcp/public — the MCP server without an account, for trying the tools.
 *
 * Same protocol, tool definitions, prompts and resources as /mcp (functions/mcp.ts), with these differences:
 *   - never HTTP 401: credentials are ignored and every caller is the salted hash of their network address;
 *   - tools/list and tools/call cover the read-only tools only (every tool but save_cohort);
 *   - search_datasets reads questions with the built-in vocabulary only, so no model is ever called;
 *   - tools/call and resources/read are limited per address an hour (MCP_PUBLIC_RATE_PER_HOUR, default 60)
 *     and for all addresses a day (MCP_PUBLIC_DAILY_CAP, default 5000), and counted per tool and month.
 * /mcp stays as it is: Claude's connectors start sign-in only on its 401.
 */
import type { AppEnv } from "../_shared/env";
import { mcpGetHandler, mcpPostHandler } from "../mcp";
import { CORS_HEADERS } from "../_shared/cors";

export const onRequestPost: PagesFunction<AppEnv> = mcpPostHandler({ pub: true });
export const onRequestGet: PagesFunction<AppEnv> = mcpGetHandler({ pub: true });
export const onRequestOptions: PagesFunction<AppEnv> = async () => new Response(null, { status: 204, headers: CORS_HEADERS });

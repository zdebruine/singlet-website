/**
 * POST /oauth/revoke — token revocation (RFC 7009); ends the connection the token belongs to.
 * See ../_shared/mcp-oauth.ts.
 */
import type { AppEnv } from "../_shared/env";
import { revoke } from "../_shared/mcp-oauth";

export const onRequest: PagesFunction<AppEnv> = ({ request, env }) => revoke(request, env);

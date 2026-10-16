/**
 * Error responses that never echo internals. The cause (a D1 message, a SQL
 * fragment, a stack) goes to the Worker log with a request id, and the caller
 * gets only the id, which is enough to find the log line.
 */
import { CORS_HEADERS } from "./cors";

export function requestId(): string {
  const b = new Uint8Array(6);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function serverError(cause: unknown, context: string, extra: Record<string, unknown> = {}, status = 500): Response {
  const id = requestId();
  console.error(`[${id}] ${context}:`, cause instanceof Error ? (cause.stack ?? cause.message) : String(cause));
  return new Response(JSON.stringify({ error: "Internal error", request_id: id, ...extra }), {
    status,
    headers: CORS_HEADERS,
  });
}

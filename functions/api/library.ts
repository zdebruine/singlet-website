/**
 * POST /api/library — the signed-in user's libraries (named folders of studies, D1).
 *
 * Browser session or API key (a key acts as its owner). Body: { action, ... }
 *   { action: "list" }                                  → { libraries: Library[] }
 *   { action: "create", name, gse_ids? }                → { id, libraries }
 *   { action: "rename", id, name }                      → { libraries }
 *   { action: "delete", id }                            → { libraries }
 *   { action: "add", id, gse_ids }                      → { added, libraries }
 *   { action: "remove", id, gse_ids }                   → { libraries }
 * Library = { id, name, gse_ids, created_at, updated_at }. Errors are { error, message }.
 * Rules and caps live in ../_shared/library.
 */
import type { AppEnv } from "../_shared/env";
import { requireUser } from "../_shared/identity";
import {
  LibraryError,
  addItems,
  cleanIds,
  cleanName,
  createLibrary,
  deleteLibrary,
  listLibraries,
  removeItems,
  renameLibrary,
} from "../_shared/library";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export const onRequest: PagesFunction<AppEnv> = async ({ request, env, waitUntil }) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed", message: "POST only." }, 405, { Allow: "POST" });

  const who = await requireUser(request, env, waitUntil, "Sign in to keep a library of studies.");
  if (!who.ok) return who.response;
  const userId = who.identity.userId;

  const raw: unknown = await request.json().catch(() => null);
  const body = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const action = typeof body.action === "string" ? body.action : "";
  const db = env.DB;

  try {
    if (action === "list") return json({ libraries: await listLibraries(db, userId) });

    if (action === "create") {
      const name = cleanName(body.name);
      if (!name) return json({ error: "invalid_name", message: "Give the library a name (1–60 characters)." }, 400);
      const ids = body.gse_ids === undefined ? [] : cleanIds(body.gse_ids);
      if (!ids) return json({ error: "invalid_ids", message: "gse_ids must be a list of GSE accessions." }, 400);
      const id = await createLibrary(db, userId, name, ids);
      return json({ id, libraries: await listLibraries(db, userId) });
    }

    if (action === "rename") {
      const name = cleanName(body.name);
      if (!name) return json({ error: "invalid_name", message: "Give the library a name (1–60 characters)." }, 400);
      await renameLibrary(db, userId, body.id, name);
      return json({ libraries: await listLibraries(db, userId) });
    }

    if (action === "delete") {
      await deleteLibrary(db, userId, body.id);
      return json({ libraries: await listLibraries(db, userId) });
    }

    if (action === "add" || action === "remove") {
      const ids = cleanIds(body.gse_ids);
      if (!ids || !ids.length) return json({ error: "invalid_ids", message: "gse_ids must be a non-empty list of GSE accessions." }, 400);
      if (action === "add") {
        const added = await addItems(db, userId, body.id, ids);
        return json({ added, libraries: await listLibraries(db, userId) });
      }
      await removeItems(db, userId, body.id, ids);
      return json({ libraries: await listLibraries(db, userId) });
    }

    return json({ error: "unknown_action", message: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof LibraryError) return json({ error: e.code, message: e.message }, e.status);
    return json({ error: "library_unavailable", message: "The library is unavailable right now. Try again shortly." }, 503);
  }
};

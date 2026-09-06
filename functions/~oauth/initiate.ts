/**
 * Managed Google sign-in on singlet.bio.
 *
 * Lovable Cloud's Google app is reached through the hosted broker at
 * oauth.lovable.app. On Lovable-hosted domains a platform worker intercepts
 * `/~oauth/initiate`; singlet.bio is served by Cloudflare Pages, so we do the
 * same hop here: forward the query string untouched and add the project id.
 * No client id or secret of ours is involved — the broker holds them, and it
 * only accepts redirect_uri values on the project's auth allow-list.
 *
 * The rest of the round-trip needs nothing from us: Google returns to
 * oauth.lovable.app/callback, which sends the browser back to the
 * `redirect_uri` we passed (`https://<host>/auth/callback`) with the session
 * tokens in the URL fragment, where the auth client picks them up.
 */
const BROKER = "https://oauth.lovable.app/initiate";
const PROJECT_ID = "lovp_735241pm6n8r3a7are3rf3wng0";

export const onRequestGet: PagesFunction = async ({ request }) => {
  const incoming = new URL(request.url);
  const target = new URL(BROKER);
  incoming.searchParams.forEach((v, k) => target.searchParams.set(k, v));
  target.searchParams.set("project_id", PROJECT_ID);
  return Response.redirect(target.toString(), 302);
};

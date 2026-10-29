// beta.singlet.bio -> the Pages project `singlet-beta` (production branch `beta`). The zone's DNS cannot be edited with the deploy token,
// and a Workers Custom Domain creates its own record, so this Worker forwards requests, as workers/alpha-proxy does.
const UPSTREAM = "singlet-beta.pages.dev";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const host = url.host;
    url.hostname = UPSTREAM;
    url.port = "";
    const res = await fetch(new Request(url, request), { redirect: "manual" });
    const out = new Response(res.body, res);
    const loc = out.headers.get("location");
    if (loc) out.headers.set("location", loc.replace(UPSTREAM, host));
    out.headers.set("X-Robots-Tag", "noindex, nofollow");
    return out;
  },
};

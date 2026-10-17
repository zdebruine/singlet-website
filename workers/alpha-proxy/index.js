// alpha.singlet.bio -> the `alpha` branch preview on Pages. A Pages custom domain always serves
// production, and Host-header overrides are not on the Free plan, so this Worker forwards requests.
const UPSTREAM = "alpha.singlet-4gc.pages.dev";

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

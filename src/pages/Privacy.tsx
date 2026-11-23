import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";

const Privacy = () => {
  usePageMeta({ title: "Privacy", description: "What singlet.bio stores when you browse, search, sign in, create an API key, use the MCP server, send feedback or join the Beta list, and where AI processing happens.", path: "/privacy" });
  return (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-12 md:py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-8">
          Privacy Policy
        </h1>
        <p className="text-xs text-muted-foreground mb-8 font-mono">Last updated: October 28, 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-muted-foreground">
          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">1. No Account Required</h2>
            <p className="text-sm leading-relaxed">
              You do not need an account to browse this website, to search it, or to download the atlas. Data downloads
              are public and free, served from our CDN. An account is optional: it raises the daily limit on AI-assisted
              searches, issues API keys, and holds any private projects, cohorts and workspaces you create.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">2. Your Data Stays on Your Machine</h2>
            <p className="text-sm leading-relaxed">
              The <span className="font-mono">singlet</span> software and pipeline run locally on your own computer, and
              your data is never sent to us unless you choose to add a .singlet file to a private project. Such a file is
              stored privately and can be read only by you, by members of a workspace you share the project with, or by
              someone you give the project's read link. We do not use any data to train models.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">3. Information We Collect</h2>
            <p className="text-sm leading-relaxed mb-2">
              We collect very little. Like most websites, our hosting and content-delivery providers automatically record
              standard technical logs when you visit or download files, which may include:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>IP address and approximate region</li>
              <li>Browser and device type (user agent)</li>
              <li>Pages or files requested, and the date and time</li>
            </ul>
            <p className="text-sm leading-relaxed mt-2">
              We use this only in aggregate to understand traffic, keep the site reliable, and protect against abuse.
            </p>
            <p className="text-sm leading-relaxed mt-3">
              We also keep our own analytics of this website (section 10) to see how it is used: which pages are visited
              and for how long, how far they are scrolled, which site or campaign link brought a visit,
              and whether a visitor comes back.
            </p>
            <p className="text-sm leading-relaxed mt-3 mb-2">
              AI-assisted search is rate-limited per day. To enforce that limit we keep one counter per person per day
              (how many AI searches or explanations were used, and the times of the first and last one):
            </p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>
                Without an account: the counter is keyed to a salted, one-way hash of your network address. The address
                itself is not stored.
              </li>
              <li>With an account or an API key: the counter is keyed to your account.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">4. What Signing In Stores</h2>
            <p className="text-sm leading-relaxed mb-2">
              Signing in is optional and uses GitHub or Google; we never see or store a password. GitHub is asked only
              to read your profile and email addresses, Google only for your basic profile and email address. We keep:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>
                Your account: the verified email address, display name and profile-picture link the provider shares,
                when the account was created and when you last signed in.
              </li>
              <li>
                Each linked sign-in: the provider (GitHub or Google), that provider's id for your account and the email
                it reported, so we recognise you next time. A GitHub and a Google account with the same verified email
                share one singlet.bio account.
              </li>
              <li>
                Each browser session: a one-way hash of the session token (the token itself lives only in your
                browser's cookie), when it was created, last used and expires (about 30 days after last use), and the
                browser type (user agent). Signing out deletes the session.
              </li>
              <li>
                While a sign-in is in progress, for at most 10 minutes: a hash of the one-time state value, the one-time
                PKCE verifier for that attempt, the site it started on and the page to return to. It is deleted when the
                sign-in completes or expires.
              </li>
              <li>
                API keys you create: a name, the first characters of the key, a one-way hash of the key, and when it was
                created, last used, expires and was revoked. The key itself is shown to you once and never stored.
              </li>
              <li>
                Anything you create while signed in: private projects and the .singlet files you add to them, cohorts,
                workspaces, their members, invitations (the invitee's email, if you enter one) and a workspace activity
                list (who added or changed what, and when).
              </li>
            </ul>
            <p className="text-sm leading-relaxed mt-2">
              The provider's access token is used once, during sign-in, to read the profile above, and is not kept.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">5. AI Processing</h2>
            <p className="text-sm leading-relaxed">
              A plain-English search is first read by our built-in vocabulary, on our own servers. Only when that leaves
              words it cannot place is the text of the search sent to a language model, which turns it into catalog
              filters. Signed-in users can also ask for one-sentence explanations of why each study matches; that sends
              the search text and the public descriptions of the studies on screen. Nothing else is sent: not your
              account, email or network address.
            </p>
            <p className="text-sm leading-relaxed mt-2">
              The model runs on Cloudflare Workers AI, called through Cloudflare AI Gateway, which can keep short-term
              logs of model requests and replies in our Cloudflare account for monitoring and abuse protection. If we
              configure it, Anthropic's API (Claude) is used instead of Workers AI, and receives the same text.
            </p>
            <p className="text-sm leading-relaxed mt-2">
              To avoid paying for the same question twice, we cache each interpretation by the normalised search text,
              and each explanation by the search text and study accession. Neither cache records who asked. We do not
              use searches to train models.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">6. The MCP Server</h2>
            <p className="text-sm leading-relaxed">
              The MCP server at <span className="font-mono">https://singlet.bio/mcp</span> lets an AI assistant you
              connect call singlet.bio tools; <span className="font-mono">https://singlet.bio/mcp/public</span> serves
              the read-only tools without an account. The server only ever receives the arguments of each tool call your
              assistant makes (for example a search question or a GEO accession), never the rest of your conversation. It
              keeps no session and no log of individual calls, their arguments or their results. What it does record:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 mt-2">
              <li>
                A count of tool calls per account, tool and month (on <span className="font-mono">/mcp/public</span>, per
                salted hash of your network address instead of an account). Account counts are kept for 24 months; counts
                from the public endpoint for about 90 days. Then they are deleted.
              </li>
              <li>
                Short-lived rate-limit counters (calls per minute per account, or per hour per address on the public
                endpoint), deleted after a few windows.
              </li>
              <li>
                The daily AI-search counter from section 3, only when a search needs a fresh AI reading: keyed to the
                salted hash of your network address, or to your account when you send an API key.
              </li>
              <li>The interpretation cache from section 5, keyed by question text, with no identity.</li>
              <li>With an API key: the key's last-used time.</li>
              <li>A cohort, if you ask it to save one (its name, notes, accessions and visibility), in your account.</li>
            </ul>
            <p className="text-sm leading-relaxed mt-2">
              Search questions that need a fresh AI reading are processed as described in section 5. Every other tool
              is computed from the catalog or read from the public files, with no model call. Our hosting provider's
              standard request logs (section 3) apply as for any other request.
            </p>
          </section>

          <section id="beta" className="scroll-mt-20">
            <h2 className="font-display text-lg font-bold text-foreground mb-3">7. Feedback and the Beta List</h2>
            <p className="text-sm leading-relaxed mb-2">
              The feedback form stores your message, the category you pick, the path of the page you sent it from (never its query
              string), your browser type (user agent), and an email address only if you give one. The Beta sign-up form on{" "}
              <span className="font-mono">/beta</span> stores your email address and, only if you fill them in, your name,
              institution, role and what you would use Singlet for, plus whether you opted in to updates. Neither stores your
              network address. For both:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>If you are signed in, the entry is linked to your account.</li>
              <li>
                To limit abuse, each entry carries the same identity key as the AI-search counter in section 3: a salted, one-way
                hash of your network address, or your account.
              </li>
              <li>
                We use a Beta sign-up only to tell you when Beta opens and, if you opted in, to send occasional updates before then.
                We never sell or share it.
              </li>
              <li>To remove an entry, ask through the contact in section 12; we delete it.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">8. Data Retention</h2>
            <p className="text-sm leading-relaxed">
              Standard technical logs are retained for a limited period for security and operational purposes, then
              discarded or aggregated. Expired sessions and unfinished sign-ins are deleted. Account data is kept while
              the account exists. Website analytics (section 10) are kept for 90 days, then deleted. MCP tool-call counts
              (section 6) are kept for 24 months per account and about 90 days per network address.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">9. Third-Party Services</h2>
            <p className="text-sm leading-relaxed">
              The website, its database, file storage, downloads and the default language model all run on Cloudflare
              (Pages, D1, R2, Workers AI, AI Gateway and Workers Analytics Engine). GitHub or Google handle sign-in if
              you choose them, and Anthropic receives AI search text only if we enable it (section 5). These providers
              process requests under their own privacy policies. We do not sell or share your data with advertisers.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">10. Cookies and Tracking</h2>
            <p className="text-sm leading-relaxed">
              We do not use third-party advertising or cross-site tracking cookies. Signing in sets one first-party
              cookie that keeps you signed in (and a short-lived one while the sign-in completes).
            </p>
            <p className="text-sm leading-relaxed mt-2">
              Website analytics are our own, stored in our Cloudflare account; no analytics company receives them. The
              site keeps a random visitor id and session id in your browser's local storage (not a cookie), so a return
              visit is recognised. For each page it records the path, how long the page was visible and how far it was
              scrolled; for the first page of a visit, the referring site and any campaign tags in the link; and with
              each event the browser, operating system, device type and screen width, whether you were signed in (not
              who you are), and the country and region Cloudflare derives from your network address (the address itself
              is not stored). It does not record clicks, what you type or your screen, and the API, MCP server and data
              downloads are not tracked this way. Nothing is sent when your browser asks not to be tracked (Do Not Track
              or Global Privacy Control). Clearing this site's storage gives you a new visitor id.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">11. Changes to This Policy</h2>
            <p className="text-sm leading-relaxed">
              We may update this Privacy Policy from time to time. Material changes will be reflected on this page with an updated date.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">12. Contact</h2>
            <p className="text-sm leading-relaxed">
              For privacy-related questions, open an issue on{" "}
              <a href="https://github.com/Singlet-Bio/singlet/issues" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">GitHub Issues</a>.
            </p>
          </section>
        </div>
      </div>
    </section>
    <Footer />
  </div>
  );
};

export default Privacy;

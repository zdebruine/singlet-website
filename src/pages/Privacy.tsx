import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { usePageMeta } from "@/hooks/usePageMeta";

const Privacy = () => {
  usePageMeta({ title: "Privacy", description: "What singlet.bio stores when you browse, search, sign in, create an API key or use the MCP server, and where AI processing happens.", path: "/privacy" });
  return (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-12 md:py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-8">
          Privacy Policy
        </h1>
        <p className="text-xs text-muted-foreground mb-8 font-mono">Last updated: September 30, 2026</p>

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
              connect call singlet.bio tools. It only ever receives the arguments of each tool call your assistant makes
              (for example a search question or a GEO accession), never the rest of your conversation. It keeps no
              session and does not log tool calls, their arguments or their results. What it does record:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1 mt-2">
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

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">7. Data Retention</h2>
            <p className="text-sm leading-relaxed">
              Standard technical logs are retained for a limited period for security and operational purposes, then
              discarded or aggregated. Expired sessions and unfinished sign-ins are deleted. Account data is kept while
              the account exists. We do not build profiles of individual visitors.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">8. Third-Party Services</h2>
            <p className="text-sm leading-relaxed">
              The website, its database, file storage, downloads and the default language model all run on Cloudflare
              (Pages, D1, R2, Workers AI and AI Gateway). GitHub or Google handle sign-in if you choose them, and
              Anthropic receives AI search text only if we enable it (section 5). These providers process requests under
              their own privacy policies. We do not sell or share your data with advertisers.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">9. Cookies and Tracking</h2>
            <p className="text-sm leading-relaxed">
              We do not use third-party advertising or cross-site tracking cookies. Any cookies used are limited to
              what is necessary for the website to function: signing in sets one first-party cookie that keeps you
              signed in (and a short-lived one while the sign-in completes).
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">10. Changes to This Policy</h2>
            <p className="text-sm leading-relaxed">
              We may update this Privacy Policy from time to time. Material changes will be reflected on this page with an updated date.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">11. Contact</h2>
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

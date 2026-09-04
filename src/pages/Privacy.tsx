import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Privacy = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-12 md:py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-8">
          Privacy Policy
        </h1>
        <p className="text-xs text-muted-foreground mb-8 font-mono">Last updated: June 19, 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-muted-foreground">
          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">1. No Account Required</h2>
            <p className="text-sm leading-relaxed">
              You do not need an account to browse this website, to search it, or to download the atlas. Data downloads
              are public and free, served from our CDN. An account is optional and exists only to raise the daily limit on
              AI-assisted searches and to issue API keys.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">2. Your Data Stays on Your Machine</h2>
            <p className="text-sm leading-relaxed">
              The <span className="font-mono">singlet</span> software and pipeline run locally on your own computer.
              We do not host an upload service for your data, and your data is never sent to us. We do not use any data
              to train models.
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
              AI-assisted search is rate-limited per day. To enforce that limit we keep:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>
                Without an account: a daily count keyed to a salted, one-way hash of your network address. The address
                itself is not stored and the hash cannot be reversed.
              </li>
              <li>
                With an account: your email address (or the address your Google or GitHub account provides) and a daily
                count of AI requests. Nothing else about your account is stored.
              </li>
              <li>
                API keys you create: a name, the first characters of the key, a one-way hash of the key, and when it was
                created, last used, expires and was revoked. The key itself is shown to you once and never stored.
              </li>
            </ul>
            <p className="text-sm leading-relaxed mt-2">
              The text of a plain-English search is sent to a language model to turn it into catalog filters. The
              interpretation is cached for a short time by question text alone; it is not linked to you or your account.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">4. Data Retention</h2>
            <p className="text-sm leading-relaxed">
              Standard technical logs are retained for a limited period for security and operational purposes, then
              discarded or aggregated. We do not build profiles of individual visitors.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">5. Third-Party Services</h2>
            <p className="text-sm leading-relaxed">
              We rely on infrastructure providers to host the website, run sign-in, and serve downloads (content delivery,
              object storage, authentication and a language-model gateway). These providers process standard request
              logs under their own privacy policies. We do not sell or share your data with advertisers.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">6. Cookies and Tracking</h2>
            <p className="text-sm leading-relaxed">
              We do not use third-party advertising or cross-site tracking cookies. Any cookies used are limited to
              what is necessary for the website to function.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">7. Changes to This Policy</h2>
            <p className="text-sm leading-relaxed">
              We may update this Privacy Policy from time to time. Material changes will be reflected on this page with an updated date.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">8. Contact</h2>
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

export default Privacy;

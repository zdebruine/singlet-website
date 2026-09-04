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
              You do not need an account to browse this website or to download the atlas. Data downloads are public
              and free, served from Cloudflare R2. We do not require you to register, log in, or provide any personal information.
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
              Because there are no accounts, we collect very little. Like most websites, our hosting and content-delivery
              providers automatically record standard technical logs when you visit or download files, which may include:
            </p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>IP address and approximate region</li>
              <li>Browser and device type (user agent)</li>
              <li>Pages or files requested, and the date and time</li>
            </ul>
            <p className="text-sm leading-relaxed mt-2">
              We use this only in aggregate to understand traffic, keep the site reliable, and protect against abuse.
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
              We rely on infrastructure providers to host the website and serve downloads (including Cloudflare for
              content delivery and object storage). These providers process standard request logs under their own
              privacy policies. We do not sell or share your data with advertisers.
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
              For privacy-related questions, email{" "}
              <a href="mailto:hello@singlet.bio" className="text-primary hover:underline">hello@singlet.bio</a>.
            </p>
          </section>
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default Privacy;

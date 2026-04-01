import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Privacy = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="pt-28 pb-16 md:pt-36 md:pb-24 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-8">
          Privacy Policy
        </h1>
        <p className="text-xs text-muted-foreground mb-8 font-mono">Last updated: March 30, 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-muted-foreground">
          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">1. Information We Collect</h2>
            <p className="text-sm leading-relaxed mb-2">We collect information you provide directly:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li><strong>Account information:</strong> Email address, name, and institution when you register</li>
              <li><strong>Usage data:</strong> API calls, query parameters (species, tissue, cell type, disease), and timestamps</li>
              <li><strong>Bring Your Own Data uploads:</strong> Data you upload for projection (Pro/Enterprise only)</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">2. How We Use Your Information</h2>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>To provide and maintain the Service</li>
              <li>To enforce rate limits and detect abuse</li>
              <li>To improve model quality and accuracy (aggregated, anonymized usage patterns only)</li>
              <li>To communicate service updates and security notices</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">3. Data Security</h2>
            <p className="text-sm leading-relaxed">
              All data is encrypted in transit (TLS 1.3) and at rest (AES-256). Bring Your Own Data uploads are isolated per tenant. We do not train our models on your private data unless you explicitly opt in under an Enterprise agreement.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">4. Data Retention</h2>
            <p className="text-sm leading-relaxed">
              API query logs are retained for 90 days for rate-limiting and abuse prevention, then deleted. Bring Your Own Data uploads are retained only while your subscription is active and deleted within 30 days of account closure.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">5. Third-Party Services</h2>
            <p className="text-sm leading-relaxed">
              We use Supabase for authentication and Vercel for hosting. These providers maintain their own privacy policies and security certifications. We do not sell or share your data with advertisers.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">6. Your Rights</h2>
            <p className="text-sm leading-relaxed mb-2">You have the right to:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Access and export your account data</li>
              <li>Request deletion of your account and associated data</li>
              <li>Opt out of non-essential communications</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">7. Cookies</h2>
            <p className="text-sm leading-relaxed">
              We use essential cookies for authentication only. We do not use third-party tracking cookies or advertising pixels.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">8. Changes to This Policy</h2>
            <p className="text-sm leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify registered users of material changes via email at least 30 days before they take effect.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">9. Contact</h2>
            <p className="text-sm leading-relaxed">
              For privacy-related questions, email{" "}
              <a href="mailto:hello@singletdb.com" className="text-primary hover:underline">hello@singletdb.com</a>.
            </p>
          </section>
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default Privacy;

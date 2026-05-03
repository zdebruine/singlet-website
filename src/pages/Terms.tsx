import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Terms = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="pt-28 pb-16 md:pt-36 md:pb-24 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-8">
          Terms of Service
        </h1>
        <p className="text-xs text-muted-foreground mb-8 font-mono">Last updated: March 30, 2026</p>

        <div className="prose prose-sm max-w-none space-y-8 text-muted-foreground">
          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">1. Acceptance of Terms</h2>
            <p className="text-sm leading-relaxed">
              By accessing or using Singlet Bio ("Service"), you agree to these Terms of Service. If you do not agree, do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">2. Description of Service</h2>
            <p className="text-sm leading-relaxed">
              Singlet Bio provides an API and web interface for predictive transcriptomics intelligence, including gene expression prediction, perturbation modeling, and gene program analysis. The Service includes free, Pro, and Enterprise tiers.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">3. User Accounts</h2>
            <p className="text-sm leading-relaxed">
              You are responsible for maintaining the security of your account credentials. You must provide accurate information during registration. One person or entity may not maintain more than one free account.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">4. Acceptable Use</h2>
            <p className="text-sm leading-relaxed mb-2">You agree not to:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Use the Service for unlawful purposes</li>
              <li>Attempt to reverse-engineer the model or extract training data</li>
              <li>Exceed rate limits or circumvent access controls</li>
              <li>Resell API access without an Enterprise license</li>
              <li>Use automated systems to scrape or overload the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">5. Intellectual Property</h2>
            <p className="text-sm leading-relaxed">
              NMF gene programs (W matrix) are released under the MIT License. Cell embeddings, annotations, and curated metadata are licensed under CC-BY 4.0 for academic use or require an Enterprise license for commercial use. See our <a href="/data-license" className="text-primary hover:underline">Data License</a> page for details.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">6. Disclaimers</h2>
            <p className="text-sm leading-relaxed">
              The Service is provided "as is" without warranty of any kind. Predictions are computational outputs and should not be used as the sole basis for clinical decisions. Singlet Bio is not a medical device and is not intended for diagnostic use.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">7. Limitation of Liability</h2>
            <p className="text-sm leading-relaxed">
              To the fullest extent permitted by law, Singlet Bio shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">8. Changes to Terms</h2>
            <p className="text-sm leading-relaxed">
              We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance. We will notify registered users of material changes via email.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">9. Contact</h2>
            <p className="text-sm leading-relaxed">
              Questions about these Terms? Email us at{" "}
              <a href="mailto:hello@singlet.bio" className="text-primary hover:underline">hello@singlet.bio</a>.
            </p>
          </section>
        </div>
      </div>
    </section>
    <Footer />
  </div>
);

export default Terms;

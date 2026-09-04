import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Terms = () => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <section className="py-12 md:py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground tracking-tightest mb-8">
          Terms of Service
        </h1>
        <p className="text-xs text-muted-foreground mb-8 font-mono">Last updated: June 19, 2026</p>

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
              Singlet Bio is an open single-cell resource. It consists of a public single-cell dataset (the atlas),
              the open-source <span className="font-mono">singlet</span> software package (Python, R, and C++), and this website,
              which lets you browse and download the data. There are no paid tiers, accounts, or subscriptions.
              Data downloads are public and free, served from Cloudflare R2 with no egress fees and no API key required.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">3. License and Use</h2>
            <p className="text-sm leading-relaxed">
              The atlas data is dedicated to the public domain under CC0 1.0 and may be used for any purpose,
              including commercial use, with no attribution required. The <span className="font-mono">singlet</span> software
              is released under the MIT License. See our{" "}
              <a href="/data-license" className="text-primary hover:underline">License</a> page for details.
              The Service is provided on an as-is basis, and we may modify or discontinue any part of it at any time.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">4. Acceptable Use</h2>
            <p className="text-sm leading-relaxed mb-2">You agree not to:</p>
            <ul className="list-disc list-inside text-sm space-y-1">
              <li>Use the Service for unlawful purposes</li>
              <li>Misrepresent the source of the data or imply endorsement by Singlet Bio</li>
              <li>Interfere with, disrupt, or place an unreasonable load on the Service or its infrastructure</li>
              <li>Use automated systems in a way that degrades the Service for others</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">5. Disclaimers</h2>
            <p className="text-sm leading-relaxed">
              The Service and all data and software are provided "as is" and "as available", without warranty of any kind,
              express or implied. The data and software are intended for research use. They are not a medical device and
              are not intended for diagnostic or clinical use.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">6. Limitation of Liability</h2>
            <p className="text-sm leading-relaxed">
              To the fullest extent permitted by law, Singlet Bio shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service, the data, or the software.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">7. Changes to Terms</h2>
            <p className="text-sm leading-relaxed">
              We may update these Terms from time to time. Continued use of the Service after changes constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="font-display text-lg font-bold text-foreground mb-3">8. Contact</h2>
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

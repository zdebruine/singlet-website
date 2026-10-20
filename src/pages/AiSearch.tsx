import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/components/auth/AuthProvider";
import { OAuthButtons } from "@/components/auth/SignInDialog";
import { QueryParse } from "@/components/landing/QueryParse";
import { usePageMeta } from "@/hooks/usePageMeta";

// One job: say what AI Search is and get the visitor signed in. Limits match functions/_shared/quota.ts.

const PERKS = [
  "200 AI searches a day (10 without an account)",
  "AI explanations of why each study matches",
  "Free API keys for Python, R and Claude",
  "Libraries to save the studies you find",
];

const AiSearch = () => {
  usePageMeta({
    title: "AI Search",
    description: "Ask for single-cell data in plain English. Sign in free for 200 AI searches a day, explanations, API keys and libraries.",
    path: "/ai-search",
  });
  const { user, loading, providers, signInWithOAuth } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 container-site py-12 md:py-20">
        <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-12 lg:gap-20 items-start">
          <div className="min-w-0">
            <p className="type-mono text-primary">AI Search</p>
            <h1 className="mt-3 text-[36px] md:text-[52px] leading-[1.06] font-semibold tracking-tight">Ask for data the way you would ask a colleague.</h1>
            <p className="mt-5 max-w-[560px] text-[18px] text-muted-foreground">
              Type "microglia in the aging mouse brain". AI Search turns it into exact filters you can see, change and reuse.
            </p>
            <ul className="mt-8 space-y-3">
              {PERKS.map((p) => (
                <li key={p} className="flex gap-3 text-[16px]">
                  <Check size={19} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
            <div className="mt-10 max-w-[560px] rounded-lg border border-border p-6">
              <QueryParse />
            </div>
            <p className="mt-6 text-[14px] text-muted-foreground">
              Browsing, filtering and downloading never need an account.{" "}
              <Link to="/about#search" className="text-primary hover:underline">
                How search works →
              </Link>
            </p>
          </div>

          <aside className="lg:sticky lg:top-24 rounded-xl border border-border p-7 md:p-8 shadow-[0_24px_60px_-34px_rgba(15,31,29,0.4)]" aria-label="Sign up or sign in">
            <Logo variant="mark" height={36} link={false} />
            {user ? (
              <>
                <h2 className="mt-5 text-[24px] font-semibold tracking-tight">You are signed in.</h2>
                <p className="mt-2 text-[15px] text-muted-foreground">AI Search is on. Ask for anything.</p>
                <Link to="/browse" className="btn-primary mt-6 inline-flex">
                  Start searching
                </Link>
              </>
            ) : (
              <>
                <h2 className="mt-5 text-[24px] font-semibold tracking-tight">Sign up or sign in</h2>
                <p className="mt-2 text-[15px] text-muted-foreground">Free. One click.</p>
                <div className="mt-6">{loading ? <div className="h-24 rounded bg-secondary animate-pulse" /> : <OAuthButtons providers={providers} signInWithOAuth={signInWithOAuth} />}</div>
                <p className="mt-6 text-[12px] leading-relaxed text-muted-foreground">
                  By continuing you accept the{" "}
                  <Link to="/terms" className="underline underline-offset-2 hover:text-foreground">
                    Terms
                  </Link>{" "}
                  and{" "}
                  <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
                    Privacy policy
                  </Link>
                  .
                </p>
              </>
            )}
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default AiSearch;

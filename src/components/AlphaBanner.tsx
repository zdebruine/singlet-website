import { useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { FeedbackButton } from "@/components/FeedbackDialog";
import { cn } from "@/lib/utils";

/** Release label shown next to the wordmark and in the banner. */
export const RELEASE_LABEL = "Research Alpha preview";

/** The small "alpha" pill next to the singlet.bio wordmark. */
export function AlphaTag({ className }: { className?: string }) {
  return (
    <span className={cn("alpha-tag", className)} title={RELEASE_LABEL}>
      <span aria-hidden="true">alpha</span>
      <span className="sr-only">{RELEASE_LABEL}</span>
    </span>
  );
}

const DISMISS_KEY = "singlet.alphaBanner.dismissed.v1";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** One slim line above the header: this is the Research Alpha, and feedback shapes Beta. Dismissible per browser. */
export function AlphaBanner() {
  const [hidden, setHidden] = useState(readDismissed);
  if (hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* storage blocked: the banner just comes back on the next visit */
    }
  };

  return (
    <div className="alpha-banner" role="region" aria-label="Research Alpha notice">
      <div className="container-site flex items-center gap-3 py-1.5 text-[12.5px]">
        <p className="flex-1 min-w-0">
          <span className="font-medium text-foreground">Research Alpha</span>
          <span className="text-muted-foreground"> — Beta begins in Q1 2027; the full re-run continues through 2027. Help shape it: </span>
          <FeedbackButton category="idea" className="font-medium text-primary hover:underline underline-offset-2">
            send feedback
          </FeedbackButton>
          <span className="text-muted-foreground" aria-hidden="true"> · </span>
          <Link to="/beta#join" className="font-medium text-primary hover:underline underline-offset-2">
            join the Beta
          </Link>
          <span className="text-muted-foreground" aria-hidden="true"> · </span>
          <Link to="/known-issues" className="text-muted-foreground hover:text-foreground underline underline-offset-2">
            known issues
          </Link>
        </p>
        <button type="button" onClick={dismiss} className="shrink-0 p-0.5 rounded text-muted-foreground hover:text-foreground" aria-label="Dismiss the Research Alpha notice">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

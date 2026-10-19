import { useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Check, MessageSquare } from "lucide-react";
import { apiClient, isApiError } from "@/integrations/api/client";
import { useAuth } from "@/components/auth/AuthProvider";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type FeedbackCategory = "bug" | "data" | "idea" | "other";

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Something is broken" },
  { value: "data", label: "A problem with the data" },
  { value: "idea", label: "An idea" },
  { value: "other", label: "Something else" },
];

interface Props {
  /** Preselected category (the study page uses "data"). */
  category?: FeedbackCategory;
  /** Text put in front of the message box, e.g. "About GSE138867: ". */
  prefill?: string;
  className?: string;
  /** Button content; defaults to an icon and "Send feedback". */
  children?: ReactNode;
}

/** A button that opens the feedback form. Anyone can send feedback; an email address is optional. */
export function FeedbackButton({ category = "other", prefill = "", className, children }: Props) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [cat, setCat] = useState<FeedbackCategory>(category);
  const [message, setMessage] = useState(prefill);
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setCat(category);
      setMessage(prefill);
      setState("idle");
      setError("");
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError("");
    try {
      await apiClient.feedback.send({
        message,
        category: cat,
        page: pathname,
        website,
        ...(!user && email.trim() ? { email: email.trim() } : {}),
      });
      setState("sent");
      setMessage("");
    } catch (err) {
      setState("idle");
      setError(isApiError(err) ? err.message : "Could not send. Check your connection and try again.");
    }
  };

  return (
    <>
      <button type="button" onClick={() => onOpenChange(true)} className={className ?? "inline-flex items-center gap-1.5 text-[13px] hover:underline underline-offset-2"}>
        {children ?? (
          <>
            <MessageSquare size={13} /> Send feedback
          </>
        )}
      </button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send feedback</DialogTitle>
            <DialogDescription>Tell us what is wrong, missing or confusing. We read every message.</DialogDescription>
          </DialogHeader>
          {state === "sent" ? (
            <div className="py-2 text-[14px]" role="status">
              <p className="inline-flex items-center gap-1.5 font-medium">
                <Check size={15} className="text-primary" /> Thank you, that was sent.
              </p>
              <div className="mt-4">
                <button type="button" className="btn-secondary btn-sm" onClick={() => onOpenChange(false)}>
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <label className="block text-[13px]">
                <span className="text-muted-foreground">About</span>
                <select value={cat} onChange={(e) => setCat(e.target.value as FeedbackCategory)} className="input mt-1 w-full">
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[13px]">
                <span className="text-muted-foreground">Message</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  maxLength={4000}
                  required
                  className="input mt-1 w-full h-auto py-2"
                  placeholder="What happened, or what would help?"
                />
              </label>
              {!user && (
                <label className="block text-[13px]">
                  <span className="text-muted-foreground">Email (optional, only if you want a reply)</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input mt-1 w-full" autoComplete="email" />
                </label>
              )}
              {/* Honeypot: people never see or fill this. */}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="absolute -left-[9999px] h-0 w-0 opacity-0"
              />
              <p className="text-[12px] text-muted-foreground">We save the page you are on ({pathname}) with your message.</p>
              {error && (
                <p role="alert" className="text-[12.5px] text-destructive">
                  {error}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button type="submit" className="btn-primary btn-sm" disabled={state === "sending" || !message.trim()}>
                  {state === "sending" ? "Sending…" : "Send"}
                </button>
                <button type="button" className="btn-secondary btn-sm" onClick={() => onOpenChange(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

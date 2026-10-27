import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { apiClient, isApiError } from "@/integrations/api/client";
import { useAuth } from "@/components/auth/AuthProvider";

const ROLES: { value: string; label: string }[] = [
  { value: "", label: "Choose one (optional)" },
  { value: "student", label: "Student" },
  { value: "postdoc", label: "Postdoc" },
  { value: "faculty", label: "Faculty or group leader" },
  { value: "staff_scientist", label: "Staff scientist" },
  { value: "industry", label: "Industry scientist" },
  { value: "clinician", label: "Clinician" },
  { value: "engineer", label: "Engineer or data scientist" },
  { value: "other", label: "Other" },
];

/** The Beta sign-up form (POST /api/beta-signup). Only the email is required. */
export function BetaSignupForm() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [role, setRole] = useState("");
  const [interests, setInterests] = useState("");
  const [updates, setUpdates] = useState(false);
  const [website, setWebsite] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  // A signed-in visitor starts with their account email; they can change it.
  useEffect(() => {
    if (user?.email) setEmail((e) => e || user.email || "");
  }, [user?.email]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError("");
    try {
      await apiClient.beta.signup({
        email: email.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(institution.trim() ? { institution: institution.trim() } : {}),
        ...(role ? { role } : {}),
        ...(interests.trim() ? { interests: interests.trim() } : {}),
        updates,
        website,
      });
      setState("sent");
    } catch (err) {
      setState("idle");
      setError(isApiError(err) ? err.message : "Could not send. Check your connection and try again.");
    }
  };

  if (state === "sent") {
    return (
      <div className="surface p-5" role="status">
        <p className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Check size={16} className="text-primary" /> You are on the Beta list.
        </p>
        <p className="mt-2 text-[14px] text-muted-foreground">
          {updates ? "We will email you when Beta opens, and with occasional updates before then." : "We will email you when Beta opens."}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="surface p-5 space-y-3" aria-label="Join the Beta">
      <label className="block text-[13px]">
        <span className="text-foreground font-medium">Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" className="input mt-1" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px]">
          <span className="text-muted-foreground">Name (optional)</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" className="input mt-1" />
        </label>
        <label className="block text-[13px]">
          <span className="text-muted-foreground">Institution (optional)</span>
          <input type="text" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={200} autoComplete="organization" className="input mt-1" />
        </label>
      </div>
      <label className="block text-[13px]">
        <span className="text-muted-foreground">Role (optional)</span>
        <select value={role} onChange={(e) => setRole(e.target.value)} className="input mt-1">
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[13px]">
        <span className="text-muted-foreground">Your research, or what you would use Singlet for (optional)</span>
        <textarea
          value={interests}
          onChange={(e) => setInterests(e.target.value)}
          rows={4}
          maxLength={2000}
          className="input mt-1 h-auto py-2"
          placeholder="For example: T-cell states across human tissues; a reference for our own data"
        />
      </label>
      <label className="flex items-start gap-2 text-[13.5px] text-foreground">
        <input type="checkbox" checked={updates} onChange={(e) => setUpdates(e.target.checked)} className="mt-1" />
        <span>Also email me occasional updates before Beta opens.</span>
      </label>
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
      <p className="text-[12px] text-muted-foreground">
        We store what you enter here{user ? " and your account id" : ""}, use it only to contact you about Singlet, and never share
        or sell it. Ask us to delete it at any time.{" "}
        <Link to="/privacy#beta" className="underline underline-offset-2 hover:text-foreground">Privacy</Link>
      </p>
      {error && (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={state === "sending" || !email.trim()}>
        {state === "sending" ? "Sending…" : "Join the Beta"}
      </button>
    </form>
  );
}

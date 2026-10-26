/**
 * Beta sign-up form: validation and storage (schema/035_beta_signups.sql).
 * Anyone may sign up; each sender is throttled by their identity subject, as for feedback (functions/_shared/feedback.ts).
 * One row per email address: a repeat sign-up changes nothing and answers the same way, so the form never reveals
 * whether an address is already on the list.
 */
export const ROLES = ["student", "postdoc", "faculty", "staff_scientist", "industry", "clinician", "engineer", "other"] as const;
export type BetaRole = (typeof ROLES)[number];

export const LIMITS = { email: 254, name: 120, institution: 200, interests: 2000 } as const;
/** New sign-ups a single sender may make per hour. */
export const HOURLY_LIMIT = 3;

export interface BetaSignupInput {
  email: string;
  name: string | null;
  institution: string | null;
  role: BetaRole | null;
  interests: string | null;
  updates: boolean;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Trimmed text, null when empty; `false` when over the limit. */
function optText(v: unknown, max: number): string | null | false {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+\n/g, "\n");
  if (!t) return null;
  return t.length > max ? false : t;
}

export function parseBetaSignup(body: Record<string, unknown>): { ok: true; value: BetaSignupInput } | { ok: false; message: string } {
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return { ok: false, message: "Enter your email address." };
  if (email.length > LIMITS.email || !EMAIL_RE.test(email)) return { ok: false, message: "That email address does not look right." };
  const name = optText(body.name, LIMITS.name);
  if (name === false) return { ok: false, message: `Keep the name under ${LIMITS.name} characters.` };
  const institution = optText(body.institution, LIMITS.institution);
  if (institution === false) return { ok: false, message: `Keep the institution under ${LIMITS.institution} characters.` };
  const interests = optText(body.interests, LIMITS.interests);
  if (interests === false) return { ok: false, message: `Keep your research interests under ${LIMITS.interests} characters.` };
  const role = ROLES.find((r) => r === body.role) ?? null;
  return { ok: true, value: { email, name, institution, role, interests, updates: body.updates === true } };
}

/** True when the sender is under the hourly limit. */
export async function underLimit(db: D1Database, subject: string): Promise<boolean> {
  const since = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM beta_signups WHERE subject = ? AND created_at >= ?`)
    .bind(subject, since)
    .first<{ n: number }>();
  return (row?.n ?? 0) < HOURLY_LIMIT;
}

/** Stores a sign-up. Returns false when the address was already on the list (nothing is changed). */
export async function saveBetaSignup(
  db: D1Database,
  who: { subject: string; userId: string | null },
  input: BetaSignupInput,
): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO beta_signups (id, email, name, institution, role, interests, updates_opt_in, user_id, subject)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), input.email, input.name, input.institution, input.role, input.interests, input.updates ? 1 : 0, who.userId, who.subject)
    .run();
  return (res.meta?.changes ?? 0) > 0;
}

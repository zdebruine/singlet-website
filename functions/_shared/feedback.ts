/**
 * Feedback form: validation and storage (schema/023_library_feedback.sql).
 * Anyone may send feedback; each sender is throttled by their identity subject.
 */
export const CATEGORIES = ["bug", "data", "idea", "other"] as const;
export type FeedbackCategory = (typeof CATEGORIES)[number];

export const MESSAGE_MAX = 4000;
/** Messages a single sender may leave per hour. */
export const HOURLY_LIMIT = 5;

export interface FeedbackInput {
  category: FeedbackCategory;
  message: string;
  email: string | null;
  page: string | null;
}

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Only the path of a same-site page is kept, never a query string. */
export function cleanPage(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const path = v.split(/[?#]/)[0].trim();
  return /^\/[A-Za-z0-9._~\/-]{0,200}$/.test(path) ? path : null;
}

export function parseFeedback(body: Record<string, unknown>): { ok: true; value: FeedbackInput } | { ok: false; message: string } {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return { ok: false, message: "Write a message first." };
  if (message.length > MESSAGE_MAX) return { ok: false, message: `Keep it under ${MESSAGE_MAX} characters.` };
  const category = CATEGORIES.find((c) => c === body.category) ?? "other";
  let email: string | null = null;
  if (typeof body.email === "string" && body.email.trim()) {
    email = body.email.trim();
    if (!EMAIL_RE.test(email)) return { ok: false, message: "That email address does not look right. Leave it empty to stay anonymous." };
  }
  return { ok: true, value: { category, message, email, page: cleanPage(body.page) } };
}

/** True when the sender is under the hourly limit. */
export async function underLimit(db: D1Database, subject: string): Promise<boolean> {
  const since = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM feedback WHERE subject = ? AND created_at >= ?`)
    .bind(subject, since)
    .first<{ n: number }>();
  return (row?.n ?? 0) < HOURLY_LIMIT;
}

export async function saveFeedback(
  db: D1Database,
  who: { subject: string; userId: string | null; userAgent: string | null },
  input: FeedbackInput,
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(`INSERT INTO feedback (id, user_id, subject, category, message, email, page, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, who.userId, who.subject, input.category, input.message, input.email, input.page, who.userAgent?.slice(0, 300) ?? null)
    .run();
  return id;
}

/**
 * The signed-in visitor's access token, kept outside React so the plain
 * fetch-based API client can attach it without a hook. The AuthProvider is
 * the only writer.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export const authToken = {
  get(): string | null {
    return current;
  },
  set(token: string | null) {
    if (token === current) return;
    current = token;
    for (const fn of listeners) fn();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

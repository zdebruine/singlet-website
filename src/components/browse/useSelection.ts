import { useCallback, useEffect, useMemo, useState } from "react";
import type { StudyRow } from "@/integrations/api/types";

export interface SelectedStudy {
  gse_id: string;
  title: string | null;
  n_cells: number;
  bundle_bytes: number | null;
  has_bundle: boolean;
}

const KEY = "singlet.browse.selection.v1";

function read(): SelectedStudy[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as SelectedStudy[];
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.gse_id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Study selection for the "Load selected" bar. Kept in sessionStorage so a
 * detour to a study page and back doesn't lose the basket.
 */
export function useSelection() {
  const [items, setItems] = useState<SelectedStudy[]>(() => (typeof window === "undefined" ? [] : read()));

  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(items));
    } catch {
      /* quota / private mode — selection just won't persist */
    }
  }, [items]);

  const ids = useMemo(() => new Set(items.map((i) => i.gse_id)), [items]);

  const toggle = useCallback((row: StudyRow | SelectedStudy) => {
    setItems((prev) => {
      if (prev.some((p) => p.gse_id === row.gse_id)) return prev.filter((p) => p.gse_id !== row.gse_id);
      return [
        ...prev,
        { gse_id: row.gse_id, title: row.title, n_cells: row.n_cells, bundle_bytes: row.bundle_bytes, has_bundle: row.has_bundle },
      ];
    });
  }, []);

  const addMany = useCallback((rows: StudyRow[]) => {
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.gse_id));
      const add = rows
        .filter((r) => !seen.has(r.gse_id))
        .map((r) => ({ gse_id: r.gse_id, title: r.title, n_cells: r.n_cells, bundle_bytes: r.bundle_bytes, has_bundle: r.has_bundle }));
      return add.length ? [...prev, ...add] : prev;
    });
  }, []);

  const removeMany = useCallback((gseIds: string[]) => {
    const drop = new Set(gseIds);
    setItems((prev) => prev.filter((p) => !drop.has(p.gse_id)));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const totals = useMemo(
    () => ({
      studies: items.length,
      cells: items.reduce((a, i) => a + (i.n_cells || 0), 0),
      bytes: items.reduce((a, i) => a + (i.bundle_bytes || 0), 0),
      files: items.filter((i) => i.has_bundle).length,
    }),
    [items]
  );

  return { items, ids, toggle, addMany, removeMany, clear, totals };
}

export type Selection = ReturnType<typeof useSelection>;

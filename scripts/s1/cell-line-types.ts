/**
 * One-time catalog fix (2026-10-29): cell-line samples get their line as cell type in sample_attr and study_label, as label loads do
 * from now on (functions/_shared/s1-labels.ts, cellLineFactsSql). The labeller's primary-tissue calls on those samples are removed.
 *
 *   npx tsx scripts/s1/cell-line-types.ts > cell-line-types.sql
 *   wrangler d1 execute singlet-catalog --remote --file=cell-line-types.sql   (after a time-travel bookmark and the owner's approval)
 *
 * Idempotent. Measured 2026-10-29: 3,841 cell-line samples in 748 studies; 16,204 labeller cell-type facts out, 5,923 in; 5,221
 * study_label cell-type rows rebuilt.
 */
import { cellLineFixSql } from "../../functions/_shared/s1-labels";

process.stdout.write(`-- cell-line samples: their line as cell type (scripts/s1/cell-line-types.ts)\n${cellLineFixSql().join("\n")}\n`);

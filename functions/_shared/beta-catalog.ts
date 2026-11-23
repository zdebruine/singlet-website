/**
 * Catalog rows for Research Beta studies (Beta channel only).
 *
 * The campaign's shipper publishes each study through POST /api/ingest/s1-publish, which writes the objects, the manifest and the
 * s1_study / s1_sample rows. The pages list and search studies from the catalog tables gse, gsm and gse_meta, which s1-publish does
 * not write. This module fills gse and gsm for every published study whose rev it has not seen yet:
 *
 *   GEO metadata (titles, abstract, organism, sample fields)   from Alpha's public catalog (GET <ALPHA_API>/api/gse/<GSE>), which
 *                                                              holds the same GEO records, else from NCBI E-utilities (esummary, gds)
 *   processing fields (status, cells, medians, version, date)   from Beta's own s1_sample rows, never from Alpha
 *
 * Samples GEO lists that Beta has not published yet are written as PENDING. gse_meta is left to the refresh-next crank (it fills the
 * normalized gsm columns, then recomputes the study rollup), and index-next reads sample_qc from the .s1 objects themselves.
 * Progress is kept in beta_catalog_sync (gse_id, rev): a study is synced again when its rev changes. A study whose metadata could not
 * be fetched is recorded with its error and retried after RETRY_AFTER_MS.
 */

export const ALPHA_API_DEFAULT = "https://singlet.bio";
const RETRY_AFTER_MS = 6 * 3600 * 1000;
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UA = "singlet-beta-catalog/1 (+https://beta.singlet.bio)";

export interface StudyMeta {
  source: "alpha" | "ncbi";
  title: string | null;
  abstract: string | null;
  organism: string | null;
  pubmed_ids: string[];
  submitted_date: string | null;
  n_geo: number;
  samples: SampleMeta[];
}

export interface SampleMeta {
  gsm_id: string;
  organism?: string | null;
  protocol?: string | null;
  modality?: string | null;
  tissue?: string | null;
  cell_type?: string | null;
  donor_id?: string | null;
  disease?: string | null;
  sex?: string | null;
  title?: string | null;
  source?: string | null;
  srr_ids?: string[] | null;
  characteristics?: Record<string, unknown> | null;
}

interface PublishedSample {
  gsm_id: string;
  n_called: number | null;
  median_umi: number | null;
  median_genes: number | null;
  updated_at: string;
}

interface PendingStudy {
  gse_id: string;
  rev: string;
  n_samples: number;
  n_cells_called: number | null;
  pipeline_json: string | null;
  updated_at: string;
}

const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

async function getJson(url: string, timeoutMs = 15000): Promise<unknown | null> {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

/** Alpha's public study record: series fields plus every GEO sample Alpha knows. Null when Alpha has no such study. */
export async function fromAlpha(gse: string, base = ALPHA_API_DEFAULT): Promise<StudyMeta | null> {
  const d = (await getJson(`${base}/api/gse/${gse}`)) as { series?: Record<string, unknown>; samples?: Record<string, unknown>[]; completeness?: { geo_samples?: number } } | null;
  if (!d?.series) return null;
  const sr = d.series;
  let pmids: string[] = [];
  try {
    const p = typeof sr.pubmed_ids === "string" ? JSON.parse(sr.pubmed_ids) : sr.pubmed_ids;
    if (Array.isArray(p)) pmids = p.map(String);
  } catch {
    /* not JSON */
  }
  const samples: SampleMeta[] = (d.samples ?? [])
    .filter((x) => typeof x.gsm_id === "string")
    .map((x) => ({
      gsm_id: String(x.gsm_id),
      organism: s(x.organism),
      protocol: s(x.protocol),
      modality: s(x.modality),
      tissue: s(x.tissue),
      cell_type: s(x.cell_type),
      donor_id: s(x.donor_id),
      disease: s(x.disease),
      sex: s(x.sex),
      title: s(x.title),
      source: s(x.source),
      srr_ids: Array.isArray(x.srr_ids) ? x.srr_ids.map(String) : null,
      characteristics: x.characteristics && typeof x.characteristics === "object" ? (x.characteristics as Record<string, unknown>) : null,
    }));
  const nGeo = Number(d.completeness?.geo_samples ?? sr.n_gsm_total ?? samples.length) || samples.length;
  return {
    source: "alpha",
    title: s(sr.title),
    abstract: s(sr.abstract),
    organism: s(sr.organism),
    pubmed_ids: pmids,
    submitted_date: s(sr.submitted_date),
    n_geo: nGeo,
    samples,
  };
}

/** GEO's own summary of a series (NCBI E-utilities, db=gds): title, summary, organism, PubMed ids and the sample list with titles. */
export async function fromNcbi(gse: string): Promise<StudyMeta | null> {
  const es = (await getJson(`${EUTILS}/esearch.fcgi?db=gds&retmode=json&term=${gse}%5BACCN%5D+AND+gse%5BETYP%5D`)) as {
    esearchresult?: { idlist?: string[] };
  } | null;
  const uid = es?.esearchresult?.idlist?.[0];
  if (!uid) return null;
  const sm = (await getJson(`${EUTILS}/esummary.fcgi?db=gds&retmode=json&id=${uid}`)) as { result?: Record<string, Record<string, unknown>> } | null;
  const r = sm?.result?.[uid];
  if (!r) return null;
  const pdat = s(r.pdat);
  const samples = (Array.isArray(r.samples) ? (r.samples as { accession?: string; title?: string }[]) : [])
    .filter((x) => typeof x.accession === "string" && /^GSM\d+$/.test(x.accession))
    .map((x) => ({ gsm_id: String(x.accession), title: s(x.title), organism: s(r.taxon) }));
  return {
    source: "ncbi",
    title: s(r.title),
    abstract: s(r.summary),
    organism: s(r.taxon),
    pubmed_ids: Array.isArray(r.pubmedids) ? (r.pubmedids as unknown[]).map(String) : [],
    submitted_date: pdat ? pdat.replace(/\//g, "-") : null,
    n_geo: Number(r.n_samples) || samples.length,
    samples,
  };
}

export async function ensureSyncTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS beta_catalog_sync (gse_id TEXT PRIMARY KEY, rev TEXT NOT NULL, source TEXT, n_geo INTEGER,
         n_published INTEGER, error TEXT, synced_at TEXT NOT NULL)`,
    )
    .run();
}

/** Published studies (verified s1 rev) whose catalog rows are missing or older than their rev. */
export async function pendingStudies(db: D1Database, n: number, only?: string[]): Promise<{ rows: PendingStudy[]; remaining: number }> {
  const retryBefore = new Date(Date.now() - RETRY_AFTER_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
  const base = `FROM s1_study st JOIN s1_migration mg ON mg.gse_id = st.gse_id AND mg.status IN ('verified', 'retired')
                LEFT JOIN beta_catalog_sync y ON y.gse_id = st.gse_id`;
  const onlySql = only?.length ? ` AND st.gse_id IN (${only.map(() => "?").join(",")})` : "";
  const pend = only?.length ? `1 = 1` : `(y.rev IS NULL OR y.rev != st.rev OR (y.error IS NOT NULL AND y.synced_at < ?))`;
  const binds = only?.length ? only : [retryBefore];
  const rows = await db
    .prepare(`SELECT st.gse_id, st.rev, st.n_samples, st.n_cells_called, st.pipeline_json, st.updated_at ${base} WHERE ${pend}${onlySql} ORDER BY st.updated_at LIMIT ?`)
    .bind(...binds, n)
    .all<PendingStudy>();
  const cnt = await db
    .prepare(`SELECT COUNT(*) AS c ${base} WHERE ${pend}${onlySql}`)
    .bind(...binds)
    .first<{ c: number }>();
  return { rows: rows.results ?? [], remaining: Math.max(0, Number(cnt?.c ?? 0) - (rows.results?.length ?? 0)) };
}

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Writes gse and gsm rows for one study. Returns the number of statements run. */
export async function writeStudy(db: D1Database, st: PendingStudy, meta: StudyMeta): Promise<{ statements: number; published: number; listed: number }> {
  const pub = await db
    .prepare(`SELECT gsm_id, n_called, median_umi, median_genes, updated_at FROM s1_sample WHERE gse_id = ? AND rev = ?`)
    .bind(st.gse_id, st.rev)
    .all<PublishedSample>();
  const published = new Map((pub.results ?? []).map((p) => [p.gsm_id, p]));
  let version: string | null = null;
  try {
    version = s(JSON.parse(st.pipeline_json ?? "{}").singlet_version);
  } catch {
    /* keep null */
  }
  const stamp = nowIso();
  const bySample = new Map(meta.samples.map((m) => [m.gsm_id, m]));
  for (const gsm of published.keys()) if (!bySample.has(gsm)) bySample.set(gsm, { gsm_id: gsm, organism: meta.organism });
  const nCells = [...published.values()].reduce((a, p) => a + (p.n_called ?? 0), 0);

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO gse (id, title, abstract, organism, n_gsm_total, n_gsm_done, n_gsm_failed, n_cells, pubmed_ids, submitted_date, last_updated)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, abstract = excluded.abstract, organism = excluded.organism,
           n_gsm_total = excluded.n_gsm_total, n_gsm_done = excluded.n_gsm_done, n_gsm_failed = 0, n_cells = excluded.n_cells,
           pubmed_ids = excluded.pubmed_ids, submitted_date = excluded.submitted_date, last_updated = excluded.last_updated`,
      )
      .bind(
        st.gse_id,
        meta.title,
        meta.abstract,
        meta.organism,
        Math.max(meta.n_geo, bySample.size),
        published.size,
        nCells || st.n_cells_called || 0,
        meta.pubmed_ids.length ? JSON.stringify(meta.pubmed_ids) : null,
        meta.submitted_date,
        stamp,
      ),
  ];
  for (const m of bySample.values()) {
    const p = published.get(m.gsm_id);
    stmts.push(
      db
        .prepare(
          `INSERT INTO gsm (gsm_id, gse_id, organism, protocol, modality, tissue, cell_type, donor_id, disease, sex, n_cells, mapping_rate,
             median_genes, median_umis, mt_pct, status, qc_flag, failure_category, failure_detail, singlet_version, pipeline_date, title, source,
             srr_ids, characteristics, last_updated, organism_primary, tissue_group, disease_group, assay_family)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, NULL, ?12, ?13, NULL, ?14, NULL, NULL, NULL, ?15, ?16, ?17, ?18, ?19, ?20, ?21,
             NULL, NULL, NULL, NULL)
           ON CONFLICT(gsm_id) DO UPDATE SET gse_id = excluded.gse_id, organism = excluded.organism, protocol = excluded.protocol,
             modality = excluded.modality, tissue = excluded.tissue, cell_type = excluded.cell_type, donor_id = excluded.donor_id,
             disease = excluded.disease, sex = excluded.sex, n_cells = excluded.n_cells, mapping_rate = NULL, median_genes = excluded.median_genes,
             median_umis = excluded.median_umis, mt_pct = NULL, status = excluded.status, qc_flag = NULL, failure_category = NULL,
             failure_detail = NULL, singlet_version = excluded.singlet_version, pipeline_date = excluded.pipeline_date, title = excluded.title,
             source = excluded.source, srr_ids = excluded.srr_ids, characteristics = excluded.characteristics, last_updated = excluded.last_updated,
             organism_primary = NULL, tissue_group = NULL, disease_group = NULL, assay_family = NULL`,
        )
        .bind(
          m.gsm_id,
          st.gse_id,
          m.organism ?? meta.organism,
          m.protocol ?? null,
          m.modality ?? null,
          m.tissue ?? null,
          m.cell_type ?? null,
          m.donor_id ?? null,
          m.disease ?? null,
          m.sex ?? null,
          p ? p.n_called : null,
          p ? p.median_genes : null,
          p ? p.median_umi : null,
          p ? "DONE" : "PENDING",
          p ? version : null,
          p ? p.updated_at.slice(0, 10) : null,
          m.title ?? null,
          m.source ?? null,
          m.srr_ids?.length ? JSON.stringify(m.srr_ids) : null,
          m.characteristics ? JSON.stringify(m.characteristics) : null,
          stamp,
        ),
    );
  }
  // The study rollup is recomputed by refresh-next (missing or stale gse_meta).
  stmts.push(db.prepare(`UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = ?`).bind(st.gse_id));
  stmts.push(
    db
      .prepare(
        `INSERT INTO beta_catalog_sync (gse_id, rev, source, n_geo, n_published, error, synced_at) VALUES (?, ?, ?, ?, ?, NULL, ?)
         ON CONFLICT(gse_id) DO UPDATE SET rev = excluded.rev, source = excluded.source, n_geo = excluded.n_geo,
           n_published = excluded.n_published, error = NULL, synced_at = excluded.synced_at`,
      )
      .bind(st.gse_id, st.rev, meta.source, meta.n_geo, published.size, stamp),
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return { statements: stmts.length, published: published.size, listed: bySample.size };
}

export async function recordError(db: D1Database, st: PendingStudy, error: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO beta_catalog_sync (gse_id, rev, source, n_geo, n_published, error, synced_at) VALUES (?, ?, NULL, NULL, NULL, ?, ?)
       ON CONFLICT(gse_id) DO UPDATE SET rev = excluded.rev, error = excluded.error, synced_at = excluded.synced_at`,
    )
    .bind(st.gse_id, st.rev, error.slice(0, 300), nowIso())
    .run();
}

/** One bounded sync step over at most `n` studies. */
export async function syncStudies(
  db: D1Database,
  n: number,
  opts: { alphaApi?: string; only?: string[] } = {},
): Promise<{ synced: { gse: string; source: string; published: number; listed: number }[]; failed: { gse: string; error: string }[]; remaining: number; statements: number }> {
  await ensureSyncTable(db);
  const { rows, remaining } = await pendingStudies(db, n, opts.only);
  const synced: { gse: string; source: string; published: number; listed: number }[] = [];
  const failed: { gse: string; error: string }[] = [];
  let statements = 0;
  for (const st of rows) {
    try {
      let meta = await fromAlpha(st.gse_id, opts.alphaApi ?? ALPHA_API_DEFAULT).catch(() => null);
      if (!meta) meta = await fromNcbi(st.gse_id);
      if (!meta) throw new Error("no GEO record found at Alpha or NCBI");
      const w = await writeStudy(db, st, meta);
      statements += w.statements;
      synced.push({ gse: st.gse_id, source: meta.source, published: w.published, listed: w.listed });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failed.push({ gse: st.gse_id, error: msg });
      await recordError(db, st, msg).catch(() => undefined);
    }
  }
  return { synced, failed, remaining, statements };
}

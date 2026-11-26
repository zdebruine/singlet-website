CREATE TABLE IF NOT EXISTS gse (
  id                TEXT PRIMARY KEY,  -- e.g. GSE123456
  title             TEXT,
  abstract          TEXT,
  organism          TEXT,
  n_gsm_total       INTEGER NOT NULL DEFAULT 0,
  n_gsm_done        INTEGER NOT NULL DEFAULT 0,
  n_gsm_failed      INTEGER NOT NULL DEFAULT 0,
  n_cells           INTEGER NOT NULL DEFAULT 0,
  pubmed_ids        TEXT,              -- JSON array: ["12345678"]
  r2_bundle_key     TEXT,              -- R2 object key for the .1pz bundle
  r2_bundle_bytes   INTEGER,
  submitted_date    TEXT,
  last_updated      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
, r2_bundle_n_gsms INTEGER);
CREATE TABLE IF NOT EXISTS gsm (
  gsm_id            TEXT PRIMARY KEY,  -- e.g. GSM123456
  gse_id            TEXT NOT NULL REFERENCES gse(id),
  organism          TEXT,
  protocol          TEXT,
  modality          TEXT,
  tissue            TEXT,
  cell_type         TEXT,
  donor_id          TEXT,
  disease           TEXT,
  sex               TEXT,
  n_cells           INTEGER,
  mapping_rate      REAL,
  median_genes      REAL,
  median_umis       REAL,
  mt_pct            REAL,
  status            TEXT NOT NULL DEFAULT 'PENDING',
  qc_flag           TEXT,              -- 'gold' | 'silver' | 'bronze' | null
  failure_category  TEXT,
  failure_detail    TEXT,
  singlet_version   TEXT,
  pipeline_date     TEXT,
  pz_size_bytes     INTEGER,
  title             TEXT,
  source            TEXT,
  srr_ids           TEXT,              -- JSON array: ["SRR123"]
  characteristics   TEXT,              -- JSON object
  last_updated      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
, tissue_group TEXT, disease_group TEXT, assay_family TEXT, organism_primary TEXT);
CREATE TABLE IF NOT EXISTS publications (
  pmid              TEXT PRIMARY KEY,
  title             TEXT,
  doi               TEXT,
  abstract          TEXT,
  year              INTEGER,
  journal           TEXT
);
CREATE TABLE IF NOT EXISTS gse_publication (
  gse_id            TEXT NOT NULL REFERENCES gse(id),
  pmid              TEXT NOT NULL REFERENCES publications(pmid),
  PRIMARY KEY (gse_id, pmid)
);
CREATE TABLE IF NOT EXISTS meta_cache (
  key               TEXT PRIMARY KEY,
  value             TEXT NOT NULL,     -- JSON
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE VIRTUAL TABLE IF NOT EXISTS fts_gse USING fts5(
  id,
  title,
  abstract,
  organism,
  content='gse',
  content_rowid='rowid'
);
CREATE TABLE IF NOT EXISTS vocab_rules (field TEXT NOT NULL, priority INTEGER NOT NULL, grp TEXT NOT NULL, match_type TEXT NOT NULL, pattern TEXT NOT NULL, PRIMARY KEY (field, priority));
CREATE VIRTUAL TABLE IF NOT EXISTS fts_gsm USING fts5(gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics, content='gsm', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS gse_meta (gse_id TEXT PRIMARY KEY, organism_primary TEXT, organisms TEXT, tissue_groups TEXT, disease_groups TEXT, assay_families TEXT, tissues_raw TEXT, cell_types_raw TEXT, n_conditions INTEGER, n_done INTEGER, n_total INTEGER, n_cells INTEGER, has_bundle INTEGER, year INTEGER, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), n_usable_samples INTEGER, reference_mismatch INTEGER, n_usable_cells INTEGER, n_lowqc_samples INTEGER, n_lowqc_cells INTEGER);
CREATE TABLE IF NOT EXISTS bundle_manifest (gse_id TEXT PRIMARY KEY, bytes INTEGER, n_files INTEGER, n_gsms_in_bundle INTEGER, manifest_n_gsms INTEGER, gsm_ids TEXT, manifest_created_at TEXT, audited_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), reference_build TEXT, singlet_version TEXT);
CREATE TABLE IF NOT EXISTS geo_enrich (gse_id TEXT PRIMARY KEY, pdat TEXT, pubmed_ids TEXT, n_samples_geo INTEGER, gdstype TEXT, fetched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS bundle_index (
         gse_id TEXT PRIMARY KEY, bytes INTEGER, entries TEXT, indexed_at TEXT
       , etag TEXT, last_modified TEXT, verified_at TEXT);
CREATE TABLE IF NOT EXISTS sample_qc (
         gsm_id TEXT PRIMARY KEY, gse_id TEXT, protocol TEXT, reference_build TEXT,
         n_input_reads INTEGER, uniquely_mapped_pct REAL, n_cells_called INTEGER,
         median_umi REAL, median_genes REAL, mapping_rate REAL, exonic_fraction REAL,
         intronic_fraction REAL, sequencing_saturation REAL, median_mito_fraction REAL,
         fraction_reads_in_cells REAL, total_genes_detected INTEGER, singlet_version TEXT,
         updated_at TEXT
       , matrix_bytes INTEGER, usable INTEGER, qc_tier INTEGER);
CREATE TABLE IF NOT EXISTS bundle_index_failure (
         gse_id TEXT PRIMARY KEY, error TEXT, updated_at TEXT
       );
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT, avatar_url TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), last_sign_in_at TEXT);
CREATE TABLE IF NOT EXISTS oauth_identities (provider TEXT NOT NULL, provider_user_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, email TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (provider, provider_user_id));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), expires_at TEXT NOT NULL, last_seen_at TEXT, user_agent TEXT);
CREATE TABLE IF NOT EXISTS oauth_states (state_hash TEXT PRIMARY KEY, provider TEXT NOT NULL, code_verifier TEXT NOT NULL, origin TEXT NOT NULL, return_to TEXT NOT NULL DEFAULT '/browse', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, key_prefix TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), last_used_at TEXT, expires_at TEXT, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS ai_usage (subject TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('search', 'explain')), user_id TEXT, count INTEGER NOT NULL DEFAULT 0, first_at TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY (subject, day, kind));
CREATE TABLE IF NOT EXISTS interpret_cache (qnorm TEXT NOT NULL, rules_version TEXT NOT NULL, model TEXT, json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (qnorm, rules_version));
CREATE TABLE IF NOT EXISTS explanations (cache_key TEXT PRIMARY KEY, query_norm TEXT NOT NULL, gse_id TEXT NOT NULL, explanation TEXT NOT NULL, model TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80), slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 3 AND 50 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT GLOB '-*' AND slug NOT GLOB '*-'), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')), joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS workspace_invites (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, email TEXT, token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, accepted_at TEXT, accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL, name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100), description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 4000), visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace', 'link')), read_token_hash TEXT NOT NULL UNIQUE, read_token_prefix TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS user_files (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK (kind IN ('upload', 'url')), filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 255), object_key TEXT, source_url TEXT, bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0 AND bytes <= 2147483648), etag TEXT, status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'indexing', 'ready', 'failed')), error TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), CHECK ((kind = 'upload' AND object_key IS NOT NULL AND source_url IS NULL) OR (kind = 'url' AND source_url IS NOT NULL AND object_key IS NULL)));
CREATE TABLE IF NOT EXISTS multipart_uploads (id TEXT PRIMARY KEY, file_id TEXT NOT NULL UNIQUE REFERENCES user_files(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, r2_upload_id TEXT NOT NULL, object_key TEXT NOT NULL, expected_bytes INTEGER NOT NULL CHECK (expected_bytes > 0 AND expected_bytes <= 2147483648), reserved_bytes INTEGER NOT NULL CHECK (reserved_bytes > 0), expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS user_studies (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, file_id TEXT NOT NULL REFERENCES user_files(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, study_id TEXT NOT NULL CHECK (length(study_id) BETWEEN 1 AND 120), title TEXT, abstract TEXT, organism_primary TEXT, organisms TEXT NOT NULL DEFAULT '[]', tissue_groups TEXT NOT NULL DEFAULT '[]', disease_groups TEXT NOT NULL DEFAULT '[]', assay_families TEXT NOT NULL DEFAULT '[]', cell_types_raw TEXT NOT NULL DEFAULT '[]', n_samples INTEGER NOT NULL DEFAULT 0 CHECK (n_samples >= 0), n_cells INTEGER, bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0), reference_build TEXT, singlet_version TEXT, year INTEGER, manifest TEXT NOT NULL DEFAULT '{}', study_meta TEXT NOT NULL DEFAULT '{}', indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), UNIQUE (project_id, study_id));
CREATE TABLE IF NOT EXISTS user_samples (id TEXT PRIMARY KEY, study_id TEXT NOT NULL REFERENCES user_studies(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, sample_id TEXT NOT NULL CHECK (length(sample_id) BETWEEN 1 AND 160), organism TEXT, tissue TEXT, tissue_group TEXT, disease TEXT, disease_group TEXT, protocol TEXT, assay_family TEXT, cell_type TEXT, characteristics TEXT NOT NULL DEFAULT '{}', UNIQUE (study_id, sample_id));
CREATE TABLE IF NOT EXISTS user_sample_qc (sample_id TEXT PRIMARY KEY REFERENCES user_samples(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, n_input_reads INTEGER, uniquely_mapped_pct REAL, n_cells_called INTEGER, median_umi REAL, median_genes REAL, mapping_rate REAL, median_mito_fraction REAL, fraction_reads_in_cells REAL, reference_build TEXT, singlet_version TEXT, summary TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS cohorts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL, name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120), notes TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 20000), query TEXT NOT NULL DEFAULT '' CHECK (length(query) <= 500), filters TEXT NOT NULL DEFAULT '{}', catalog_version TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'workspace', 'link')), share_token_hash TEXT UNIQUE, share_token_prefix TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS cohort_items (id TEXT PRIMARY KEY, cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE, public_gse_id TEXT, private_study_id TEXT REFERENCES user_studies(id) ON DELETE CASCADE, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), CHECK ((public_gse_id IS NOT NULL) + (private_study_id IS NOT NULL) = 1));
CREATE TABLE IF NOT EXISTS cohort_comments (id TEXT PRIMARY KEY, cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS activity_events (id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, actor_id TEXT REFERENCES users(id) ON DELETE SET NULL, kind TEXT NOT NULL CHECK (kind IN ('project_created', 'file_uploaded', 'file_registered', 'cohort_saved', 'comment_added', 'member_joined')), subject_id TEXT, detail TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, key_prefix TEXT, tool TEXT NOT NULL CHECK (length(tool) BETWEEN 1 AND 80), kind TEXT NOT NULL CHECK (kind IN ('mcp', 'api', 'download', 'partial_download')), calls INTEGER NOT NULL DEFAULT 1 CHECK (calls > 0), bytes INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0), ms INTEGER NOT NULL DEFAULT 0 CHECK (ms >= 0), day TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d','now')), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS account_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, weekly_summary INTEGER NOT NULL DEFAULT 0 CHECK (weekly_summary IN (0, 1)), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS summaries_indexed (gse_id TEXT PRIMARY KEY, n_samples INTEGER, indexed_at TEXT);
CREATE TABLE IF NOT EXISTS ai_spend (subject TEXT NOT NULL, month TEXT NOT NULL, micro_usd INTEGER NOT NULL DEFAULT 0, tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY (subject, month));
CREATE TABLE IF NOT EXISTS ai_reservation (id TEXT PRIMARY KEY, subject TEXT NOT NULL, month TEXT NOT NULL, micro_usd INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_usage (subject TEXT NOT NULL, month TEXT NOT NULL, tool TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL, PRIMARY KEY (subject, month, tool));
CREATE TABLE IF NOT EXISTS rate_window (subject TEXT NOT NULL, bucket TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (subject, bucket, window));
CREATE TABLE IF NOT EXISTS libraries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE TABLE IF NOT EXISTS library_items (
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  gse_id     TEXT NOT NULL CHECK (gse_id GLOB 'GSE[0-9]*'),
  added_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (library_id, gse_id)
);
CREATE TABLE IF NOT EXISTS feedback (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN ('bug','data','idea','other')),
  message    TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 4000),
  email      TEXT,
  page       TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS cloud_beta_application (
  id            TEXT PRIMARY KEY,                 -- random id
  created_at    TEXT NOT NULL,                    -- ISO UTC
  email         TEXT NOT NULL,                    -- lower-cased
  name          TEXT NOT NULL,
  affiliation   TEXT NOT NULL,                    -- institution or company
  role          TEXT NOT NULL,                    -- one of the roles offered on the form
  ai_clients    TEXT NOT NULL DEFAULT '[]',       -- JSON list: claude, chatgpt, grok, gemini, other
  data_scale    TEXT,                             -- how much data they work with
  use_case      TEXT NOT NULL,                    -- what they want to do (<= 2000 chars)
  referral      TEXT,                             -- how they heard about it
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | invited | declined
  ip_hash       TEXT,                             -- SHA-256 of the client IP, for rate limiting only
  user_agent    TEXT
);
CREATE TABLE IF NOT EXISTS sample_attr (gsm_id TEXT NOT NULL, gse_id TEXT NOT NULL, attr TEXT NOT NULL, value_raw TEXT, value_norm TEXT NOT NULL DEFAULT '', ontology_id TEXT, unit TEXT, value_num REAL, source TEXT NOT NULL CHECK (source IN ('geo','pipeline','model')), confidence REAL, evidence TEXT, extractor_version TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (gsm_id, attr, source, value_norm));
CREATE TABLE IF NOT EXISTS study_card (gse_id TEXT PRIMARY KEY, card_json TEXT NOT NULL, summary_text TEXT, extractor_version TEXT NOT NULL, model TEXT, grounded INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')));
CREATE TABLE IF NOT EXISTS pz_chunk_index (gsm_id TEXT NOT NULL, gse_id TEXT NOT NULL, file TEXT NOT NULL, n_cols INTEGER NOT NULL, chunk_cols INTEGER NOT NULL, chunk_offsets TEXT NOT NULL, perm_present INTEGER NOT NULL DEFAULT 0, extractor_version TEXT, indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')), PRIMARY KEY (gsm_id, file));
CREATE TABLE IF NOT EXISTS cloud_tool (
  slug         TEXT PRIMARY KEY,                  -- url slug, e.g. abundance-celltype-proportion-test
  task_id      TEXT NOT NULL,                     -- catalogue task id
  name         TEXT NOT NULL,
  version      TEXT NOT NULL DEFAULT '0',
  verdict      TEXT NOT NULL DEFAULT 'unrated',   -- frontier | parity | below | unrated
  summary      TEXT NOT NULL DEFAULT '',          -- one line for lists
  status       TEXT NOT NULL DEFAULT 'draft',     -- draft | approved | withdrawn
  evidence     TEXT NOT NULL,                     -- JSON, schema in src/lib/tool-evidence.ts
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  approved_by  TEXT,
  approved_at  TEXT,
  review_note  TEXT                               -- the admin's sign-off note (shown publicly with the page)
);
CREATE TABLE IF NOT EXISTS cloud_admin (
  email    TEXT PRIMARY KEY,                      -- lower-case
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "s1_study" (
  gse_id          TEXT PRIMARY KEY,
  manifest_key    TEXT NOT NULL,                 -- v2/m/<GSE>.json (mutable, max-age 300 at the edge)
  rev             TEXT NOT NULL,                 -- 16 hex: digest of the sorted sample keys + study files; the "unchanged since" token
  bytes           INTEGER,                       -- total size of the study's sample objects
  n_samples       INTEGER NOT NULL,
  created_at      TEXT,                          -- manifest created_at
  legacy_bytes    INTEGER,                       -- size of the legacy bundle this study replaced
  manifest_bytes  INTEGER,                       -- size and SHA-256 of the manifest object itself, as uploaded
  manifest_sha256 TEXT,
  n_cells_called  INTEGER,                       -- sum of n_called over the samples
  reference_build TEXT,
  packs_json      TEXT,                          -- {"exon": id, "intron": id, "whitelist": id|null}: pack ids, small
  pipeline_json   TEXT,                          -- manifest "pipeline" block, small
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS "s1_migration" (
  gse_id       TEXT PRIMARY KEY,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'running', 'uploaded', 'verified', 'failed', 'retired')),
  legacy_key   TEXT,                             -- data/<GSE>/<GSE>.singlet
  legacy_etag  TEXT,
  legacy_bytes INTEGER,
  s1_bytes     INTEGER,
  n_samples    INTEGER,
  members_by_kind TEXT,                          -- JSON counts of members per treatment (matrix / recipe / stored / raw), small
  verify_ok    INTEGER,                          -- 1 when the bit-for-bit verification passed
  commit_sha   TEXT,                             -- code that ran the migration
  migrated_at  TEXT,
  verified_at  TEXT,
  ledger_key   TEXT,
  error        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS "s1_sample" (
  gse_id          TEXT NOT NULL,
  gsm_id          TEXT NOT NULL,
  key             TEXT NOT NULL,
  bytes           INTEGER,
  sha256          TEXT,
  n_columns       INTEGER,
  n_called        INTEGER,
  n_members       INTEGER,
  median_umi      REAL,
  median_genes    REAL,
  modalities      TEXT,
  members_json    TEXT,
  cell_stats_json TEXT,
  rev             TEXT NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (gse_id, rev, gsm_id)
);
CREATE TABLE IF NOT EXISTS ontology_term (
  term_id      TEXT PRIMARY KEY,
  ontology     TEXT NOT NULL,
  label        TEXT NOT NULL,
  release      TEXT,                 -- data-version of the OBO file the term was read from
  depth        INTEGER               -- shortest is_a/part_of path to a root
);
CREATE TABLE IF NOT EXISTS ontology_closure (
  term_id      TEXT NOT NULL,
  ancestor_id  TEXT NOT NULL,
  distance     INTEGER NOT NULL,
  PRIMARY KEY (ancestor_id, term_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ontology_label (
  label_norm   TEXT NOT NULL,
  term_id      TEXT NOT NULL,
  ontology     TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('id', 'label', 'exact')),
  PRIMARY KEY (label_norm, term_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ontology_value_map (
  attr           TEXT NOT NULL,      -- sample_attr.attr
  organism       TEXT NOT NULL DEFAULT '',
  value_norm     TEXT NOT NULL,
  term_id        TEXT NOT NULL,
  method         TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('geo', 'model')),
  confidence     REAL NOT NULL,
  evidence       TEXT,               -- the label or synonym matched, or the model's reason
  mapper_version TEXT NOT NULL,
  PRIMARY KEY (attr, organism, value_norm, term_id)
);
CREATE TABLE IF NOT EXISTS sample_term (
  gsm_id         TEXT NOT NULL,
  gse_id         TEXT NOT NULL,
  attr           TEXT NOT NULL,
  term_id        TEXT NOT NULL,
  source         TEXT NOT NULL,      -- geo | model, from ontology_value_map
  confidence     REAL NOT NULL,
  from_attr      TEXT NOT NULL,      -- the sample_attr.attr it came from
  PRIMARY KEY (attr, term_id, gsm_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS ontology_term_count (
  attr         TEXT NOT NULL,
  term_id      TEXT NOT NULL,
  n_samples    INTEGER NOT NULL,
  n_studies    INTEGER NOT NULL,
  n_direct     INTEGER NOT NULL,     -- samples mapped to this exact term
  PRIMARY KEY (attr, term_id)
);
CREATE TABLE IF NOT EXISTS sample_property (
  gsm_id      TEXT NOT NULL,
  gse_id      TEXT NOT NULL,
  property    TEXT NOT NULL,
  value       TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('geo', 'pipeline', 'model')),
  confidence  REAL NOT NULL,
  evidence    TEXT,
  version     TEXT NOT NULL,
  PRIMARY KEY (property, value, gsm_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS property_value_map (
  attr        TEXT NOT NULL,
  match_on    TEXT NOT NULL CHECK (match_on IN ('value_norm', 'value_raw')),
  value       TEXT NOT NULL,
  property    TEXT NOT NULL,
  prop_value  TEXT NOT NULL,
  confidence  REAL NOT NULL,
  evidence    TEXT,
  version     TEXT NOT NULL,
  PRIMARY KEY (attr, match_on, value, property, prop_value)
);
CREATE TABLE IF NOT EXISTS sample_cell_summary (
  gsm_id     TEXT NOT NULL,
  gse_id     TEXT NOT NULL,
  subject    TEXT NOT NULL CHECK (subject IN ('cell_type', 'sex', 'ancestry', 'feature')),
  item       TEXT NOT NULL,
  n_cells    INTEGER NOT NULL,
  n_hi1      INTEGER,
  n_hi2      INTEGER,
  q50        REAL,
  q90        REAL,
  mean       REAL,
  version    TEXT NOT NULL,        -- labels model_version or feature method_version
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (subject, item, gsm_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS cell_feature (
  feature_id     TEXT PRIMARY KEY,   -- '<set>/<name>', e.g. 'hallmark-2023.1/HALLMARK_HYPOXIA', 'malignancy-cnv-1/score'
  feature_set    TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('score', 'category', 'flag')),
  label          TEXT NOT NULL,
  description    TEXT,
  method         TEXT NOT NULL,      -- e.g. 'rank-auc', 'cnv-inference', 'guide-call'
  method_version TEXT NOT NULL,
  source_ref     TEXT,               -- gene-set collection and release, reference panel, or model
  licence        TEXT,               -- licence of the gene set / reference (the atlas is CC0)
  organisms      TEXT,               -- JSON array of scientific names
  ontology_id    TEXT,               -- the term the feature is about, when there is one (GO, CL, ...)
  categories     TEXT,               -- JSON array, kind = 'category'
  thresholds     TEXT NOT NULL DEFAULT '[0.5, 0.8]',  -- JSON: the two cut-offs sample_cell_summary counts
  -- 'atlas': the value means the same in every study (cell-intrinsic rank statistic, fixed reference), so it may be
  -- filtered across studies; 'sample': calibrated within a sample (e.g. z against the sample's own null), comparable
  -- between cells of one sample only, never used as a cross-study filter.
  comparable     TEXT NOT NULL DEFAULT 'atlas' CHECK (comparable IN ('atlas', 'sample')),
  storage        TEXT NOT NULL CHECK (storage IN ('shard', 'sidecar')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                  TEXT PRIMARY KEY,           -- scl_<random>
  client_secret_hash         TEXT,                       -- confidential clients only
  client_name                TEXT,
  client_uri                 TEXT,
  redirect_uris              TEXT NOT NULL,              -- JSON array
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
  created_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_used_at               TEXT
);
CREATE TABLE IF NOT EXISTS oauth_requests (
  request_hash   TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,                          -- S256
  scope          TEXT NOT NULL,
  resource       TEXT NOT NULL,
  state          TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  grant_id       TEXT NOT NULL,
  client_id      TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope          TEXT NOT NULL,
  resource       TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at     TEXT NOT NULL,
  used_at        TEXT
);
CREATE TABLE IF NOT EXISTS oauth_grants (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL,
  client_name  TEXT,
  scope        TEXT NOT NULL,
  resource     TEXT NOT NULL,                            -- the MCP URL the tokens are good for
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash     TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  grant_id       TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  revoked_reason TEXT
);
CREATE TABLE IF NOT EXISTS beta_signups (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  email          TEXT NOT NULL UNIQUE CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email)),
  name           TEXT CHECK (name IS NULL OR length(name) <= 120),
  institution    TEXT CHECK (institution IS NULL OR length(institution) <= 200),
  role           TEXT CHECK (role IS NULL OR role IN ('student','postdoc','faculty','staff_scientist','industry','clinician','engineer','other')),
  interests      TEXT CHECK (interests IS NULL OR length(interests) <= 2000),
  updates_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (updates_opt_in IN (0, 1)),
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alpha_exclusions (
  gsm_id         TEXT PRIMARY KEY,
  gse_id         TEXT NOT NULL,
  reason         TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS alpha_withheld (
  gse_id         TEXT PRIMARY KEY,
  reason         TEXT,
  policy_version TEXT NOT NULL,
  added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS s1_flags (
  name       TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS label_term (
  term_id    TEXT PRIMARY KEY,
  subject    TEXT NOT NULL CHECK (subject IN ('cell_type', 'ancestry')),
  label      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE TABLE IF NOT EXISTS study_label (
  gse_id      TEXT NOT NULL,
  attr        TEXT NOT NULL CHECK (attr IN ('sex_genetic', 'ancestry_genetic', 'cell_type')),
  value       TEXT NOT NULL,       -- sample_attr.value_norm: female / male, the HANCESTRO or CL label
  ontology_id TEXT,
  n_samples   INTEGER NOT NULL,    -- served samples of the study with this value
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (gse_id, attr, value)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_gsm_gse_id         ON gsm(gse_id);
CREATE INDEX IF NOT EXISTS idx_gsm_organism        ON gsm(organism);
CREATE INDEX IF NOT EXISTS idx_gsm_status          ON gsm(status);
CREATE INDEX IF NOT EXISTS idx_gsm_protocol        ON gsm(protocol);
CREATE INDEX IF NOT EXISTS idx_gsm_tissue          ON gsm(tissue);
CREATE INDEX IF NOT EXISTS idx_gsm_cell_type       ON gsm(cell_type);
CREATE INDEX IF NOT EXISTS idx_gsm_disease         ON gsm(disease);
CREATE INDEX IF NOT EXISTS idx_gsm_sex             ON gsm(sex);
CREATE INDEX IF NOT EXISTS idx_gsm_qc_flag         ON gsm(qc_flag);
CREATE INDEX IF NOT EXISTS idx_gsm_failure_category ON gsm(failure_category);
CREATE INDEX IF NOT EXISTS idx_gsm_n_cells         ON gsm(n_cells);
CREATE INDEX IF NOT EXISTS idx_gsm_pipeline_date   ON gsm(pipeline_date);
CREATE INDEX IF NOT EXISTS idx_gse_organism        ON gse(organism);
CREATE INDEX IF NOT EXISTS idx_gse_n_cells         ON gse(n_cells);
CREATE INDEX IF NOT EXISTS idx_gse_submitted_date  ON gse(submitted_date);
CREATE INDEX IF NOT EXISTS idx_gsm_tissue_group ON gsm(tissue_group);
CREATE INDEX IF NOT EXISTS idx_gsm_disease_group ON gsm(disease_group);
CREATE INDEX IF NOT EXISTS idx_gsm_assay_family ON gsm(assay_family);
CREATE INDEX IF NOT EXISTS idx_gsm_organism_primary ON gsm(organism_primary);
CREATE INDEX IF NOT EXISTS idx_gse_meta_org ON gse_meta(organism_primary);
CREATE INDEX IF NOT EXISTS idx_gse_meta_cells ON gse_meta(n_cells);
CREATE INDEX IF NOT EXISTS idx_gse_meta_year ON gse_meta(year);
CREATE INDEX IF NOT EXISTS idx_bundle_manifest_samples_reference ON bundle_manifest(n_gsms_in_bundle, reference_build);
CREATE INDEX IF NOT EXISTS idx_sample_qc_gse_protocol ON sample_qc(gse_id, protocol);
CREATE INDEX IF NOT EXISTS idx_sample_qc_usable ON sample_qc(gse_id, usable);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS oauth_identities_user ON oauth_identities (user_id);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage (day);
CREATE INDEX IF NOT EXISTS workspaces_owner ON workspaces (owner_id);
CREATE INDEX IF NOT EXISTS workspace_members_user ON workspace_members (user_id, workspace_id);
CREATE INDEX IF NOT EXISTS workspace_invites_workspace ON workspace_invites (workspace_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_workspace ON projects (workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_files_owner ON user_files (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_files_project ON user_files (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS user_files_status ON user_files (status, kind);
CREATE INDEX IF NOT EXISTS multipart_uploads_owner ON multipart_uploads (owner_id);
CREATE INDEX IF NOT EXISTS user_studies_owner ON user_studies (owner_id, indexed_at DESC);
CREATE INDEX IF NOT EXISTS user_studies_file ON user_studies (file_id);
CREATE INDEX IF NOT EXISTS user_samples_facets ON user_samples (project_id, organism, tissue_group, disease_group, assay_family);
CREATE INDEX IF NOT EXISTS user_sample_qc_project ON user_sample_qc (project_id);
CREATE INDEX IF NOT EXISTS cohorts_owner ON cohorts (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS cohorts_workspace ON cohorts (workspace_id, updated_at DESC) WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cohort_items_cohort ON cohort_items (cohort_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS cohort_items_public_unique ON cohort_items (cohort_id, public_gse_id) WHERE public_gse_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cohort_items_private_unique ON cohort_items (cohort_id, private_study_id) WHERE private_study_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cohort_items_private_study ON cohort_items (private_study_id) WHERE private_study_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cohort_comments_cohort ON cohort_comments (cohort_id, created_at);
CREATE INDEX IF NOT EXISTS activity_workspace ON activity_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_user_day ON usage_events (user_id, day DESC, kind, tool);
CREATE INDEX IF NOT EXISTS ai_reservation_subject ON ai_reservation (subject, month, expires_at);
CREATE INDEX IF NOT EXISTS ai_reservation_month ON ai_reservation (month, expires_at);
CREATE INDEX IF NOT EXISTS libraries_user ON libraries (user_id, created_at);
CREATE INDEX IF NOT EXISTS library_items_gse ON library_items (gse_id);
CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_subject ON feedback (subject, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS cloud_beta_application_email ON cloud_beta_application (email);
CREATE INDEX IF NOT EXISTS cloud_beta_application_ip ON cloud_beta_application (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_sample_attr_attr_value ON sample_attr (attr, value_norm);
CREATE INDEX IF NOT EXISTS idx_sample_attr_attr_onto ON sample_attr (attr, ontology_id);
CREATE INDEX IF NOT EXISTS idx_sample_attr_gse_attr ON sample_attr (gse_id, attr);
CREATE INDEX IF NOT EXISTS idx_study_card_grounded ON study_card (grounded);
CREATE INDEX IF NOT EXISTS idx_pz_chunk_index_gse ON pz_chunk_index (gse_id);
CREATE INDEX IF NOT EXISTS cloud_tool_status ON cloud_tool (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ontology_term_ontology ON ontology_term (ontology);
CREATE INDEX IF NOT EXISTS idx_ontology_closure_term ON ontology_closure (term_id);
CREATE INDEX IF NOT EXISTS idx_sample_term_gsm ON sample_term (gsm_id);
CREATE INDEX IF NOT EXISTS idx_sample_term_gse ON sample_term (attr, term_id, gse_id);
CREATE INDEX IF NOT EXISTS idx_sample_property_gsm ON sample_property (gsm_id);
CREATE INDEX IF NOT EXISTS idx_sample_property_gse ON sample_property (property, value, gse_id);
CREATE INDEX IF NOT EXISTS idx_sample_cell_summary_gsm ON sample_cell_summary (gsm_id);
CREATE INDEX IF NOT EXISTS idx_sample_cell_summary_gse ON sample_cell_summary (subject, item, gse_id);
CREATE INDEX IF NOT EXISTS idx_cell_feature_set ON cell_feature (feature_set);
CREATE INDEX IF NOT EXISTS oauth_clients_created ON oauth_clients (created_at);
CREATE INDEX IF NOT EXISTS oauth_grants_user ON oauth_grants (user_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_expires ON oauth_tokens (expires_at);
CREATE INDEX IF NOT EXISTS beta_signups_created ON beta_signups (created_at DESC);
CREATE INDEX IF NOT EXISTS beta_signups_subject ON beta_signups (subject, created_at);
CREATE INDEX IF NOT EXISTS idx_alpha_exclusions_gse ON alpha_exclusions(gse_id);
CREATE INDEX IF NOT EXISTS idx_s1_sample_gsm ON s1_sample (gsm_id);
CREATE INDEX IF NOT EXISTS idx_s1_migration_status ON s1_migration (status);
CREATE INDEX IF NOT EXISTS idx_study_label_attr_value ON study_label (attr, value);
CREATE INDEX IF NOT EXISTS idx_study_label_attr_onto ON study_label (attr, ontology_id);
CREATE TRIGGER IF NOT EXISTS gse_ai AFTER INSERT ON gse BEGIN
  INSERT INTO fts_gse(rowid, id, title, abstract, organism)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.organism);
END;
CREATE TRIGGER IF NOT EXISTS gse_ad AFTER DELETE ON gse BEGIN
  INSERT INTO fts_gse(fts_gse, rowid, id, title, abstract, organism)
  VALUES ('delete', old.rowid, old.id, old.title, old.abstract, old.organism);
END;
CREATE TRIGGER IF NOT EXISTS gsm_ai AFTER INSERT ON gsm BEGIN INSERT INTO fts_gsm(rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics) VALUES (new.rowid, new.gsm_id, new.gse_id, new.title, new.source, new.tissue, new.cell_type, new.organism, new.disease, new.characteristics); END;
CREATE TRIGGER IF NOT EXISTS gsm_ad AFTER DELETE ON gsm BEGIN INSERT INTO fts_gsm(fts_gsm, rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics) VALUES ('delete', old.rowid, old.gsm_id, old.gse_id, old.title, old.source, old.tissue, old.cell_type, old.organism, old.disease, old.characteristics); END;
CREATE TRIGGER IF NOT EXISTS trg_sample_qc_moved AFTER UPDATE OF gse_id ON sample_qc
  WHEN OLD.gse_id IS NOT NEW.gse_id
BEGIN
  UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = OLD.gse_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_alpha_exclusion_added AFTER INSERT ON alpha_exclusions
BEGIN
  UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = NEW.gse_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_alpha_exclusion_removed AFTER DELETE ON alpha_exclusions
BEGIN
  UPDATE gse_meta SET n_usable_samples = NULL WHERE gse_id = OLD.gse_id;
END;
CREATE VIEW IF NOT EXISTS v2_study AS SELECT * FROM s1_study;
CREATE VIEW IF NOT EXISTS v2_sample AS SELECT * FROM s1_sample;
CREATE VIEW IF NOT EXISTS v2_migration AS SELECT *, s1_bytes AS v2_bytes FROM s1_migration;
CREATE TRIGGER IF NOT EXISTS gse_au AFTER UPDATE OF id, title, abstract, organism ON gse BEGIN
  INSERT INTO fts_gse(fts_gse, rowid, id, title, abstract, organism)
  VALUES ('delete', old.rowid, old.id, old.title, old.abstract, old.organism);
  INSERT INTO fts_gse(rowid, id, title, abstract, organism)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.organism);
END;
CREATE TRIGGER IF NOT EXISTS gsm_au AFTER UPDATE OF gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics ON gsm BEGIN
  INSERT INTO fts_gsm(fts_gsm, rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics)
  VALUES ('delete', old.rowid, old.gsm_id, old.gse_id, old.title, old.source, old.tissue, old.cell_type, old.organism, old.disease, old.characteristics);
  INSERT INTO fts_gsm(rowid, gsm_id, gse_id, title, source, tissue, cell_type, organism, disease, characteristics)
  VALUES (new.rowid, new.gsm_id, new.gse_id, new.title, new.source, new.tissue, new.cell_type, new.organism, new.disease, new.characteristics);
END;

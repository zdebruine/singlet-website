/**
 * POST /functions/v1/interpret-search-query
 *
 * Translates a natural-language single-cell catalog query into strict JSON
 * metadata filters using a Google Gemini model through the Lovable AI Gateway
 * (auto-provisioned LOVABLE_API_KEY — no external provider key required).
 *
 * Body:  { q: string, vocab?: Record<field, string[]> }
 * Reply: { interpreted: { organism, tissue, cell_type, disease, protocol, sex,
 *                         min_cells, q } }
 *
 * If `vocab` isn't supplied, the controlled vocabulary is fetched live from the
 * public catalog facets endpoint so the model only emits values that exist.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const FACETS_URL = "https://singlet.bio/api/facets";
const VOCAB_LIMIT = 60;
const MODEL = "google/gemini-3.7-flash";

const ARRAY_FIELDS = [
  "organism",
  "tissue",
  "cell_type",
  "disease",
  "protocol",
  "sex",
] as const;
type ArrayField = (typeof ARRAY_FIELDS)[number];

type Vocab = Record<ArrayField, string[]>;

interface Interpreted {
  organism: string[];
  tissue: string[];
  cell_type: string[];
  disease: string[];
  protocol: string[];
  sex: string[];
  min_cells: number | null;
  q: string | null;
}

const EMPTY: Interpreted = {
  organism: [],
  tissue: [],
  cell_type: [],
  disease: [],
  protocol: [],
  sex: [],
  min_cells: null,
  q: null,
};

const FACET_KEY: Record<ArrayField, string> = {
  organism: "organisms",
  tissue: "tissues",
  cell_type: "cell_types",
  disease: "diseases",
  protocol: "protocols",
  sex: "sexes",
};

function emptyVocab(): Vocab {
  return { organism: [], tissue: [], cell_type: [], disease: [], protocol: [], sex: [] };
}

function coerceVocab(raw: unknown): Vocab {
  const out = emptyVocab();
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const f of ARRAY_FIELDS) {
    const list = obj[f] ?? obj[FACET_KEY[f]];
    if (!Array.isArray(list)) continue;
    out[f] = list
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? String((item as { value?: unknown }).value ?? "")
            : ""
      )
      .filter((s) => s.trim() !== "")
      .slice(0, VOCAB_LIMIT);
  }
  return out;
}

async function loadVocab(): Promise<Vocab> {
  try {
    const res = await fetch(FACETS_URL, { headers: { accept: "application/json" } });
    if (!res.ok) return emptyVocab();
    return coerceVocab(await res.json());
  } catch {
    return emptyVocab();
  }
}

const SYSTEM_PROMPT =
  `You translate a single-cell genomics dataset search query into JSON metadata filters.

You are given a controlled vocabulary of allowed values for several fields. For each field, use ONLY values that appear in the provided vocabulary (match the controlled-vocabulary spelling/case exactly). If the user references a concept that is not in a field's vocabulary, leave that field's array empty and instead put the leftover keywords in "q".

Output STRICT JSON and nothing else — no prose, no markdown fences. The JSON must have exactly these keys:
{"organism":[...],"tissue":[...],"cell_type":[...],"disease":[...],"protocol":[...],"sex":[...],"min_cells":<integer or null>,"q":<string or null>}

Rules:
- Each of organism/tissue/cell_type/disease/protocol/sex is an array of strings drawn from that field's vocabulary (empty array if nothing applies).
- "min_cells" is an integer minimum cell count if the user implies one (e.g. "at least 5000 cells"), else null.
- "q" holds any free-text keywords that don't map to a vocabulary field (e.g. an author, gene, unmatched disease or cell type), else null.
- Map synonyms to the vocabulary where possible (e.g. "AML" -> a leukemia disease value if present; "human" -> "Homo sapiens" if present).`;

function extractJson(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function coerceInterpreted(raw: unknown): Interpreted {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter((s) => s.trim() !== "") : [];
  let minCells: number | null = null;
  const mc = obj.min_cells;
  if (typeof mc === "number" && !isNaN(mc)) minCells = Math.floor(mc);
  else if (typeof mc === "string" && mc.trim() !== "") {
    const n = parseInt(mc, 10);
    if (!isNaN(n)) minCells = n;
  }
  const qRaw = obj.q;
  return {
    organism: arr(obj.organism),
    tissue: arr(obj.tissue),
    cell_type: arr(obj.cell_type),
    disease: arr(obj.disease),
    protocol: arr(obj.protocol),
    sex: arr(obj.sex),
    min_cells: minCells,
    q: typeof qRaw === "string" && qRaw.trim() !== "" ? qRaw.trim() : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const q = typeof body.q === "string" ? body.q.trim() : "";
    if (!q) {
      return new Response(JSON.stringify({ error: "Missing query 'q'" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vocab = body.vocab ? coerceVocab(body.vocab) : await loadVocab();
    const vocabText = ARRAY_FIELDS.map(
      (f) => `${f}: ${vocab[f].length ? vocab[f].join(", ") : "(none)"}`
    ).join("\n");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              `Controlled vocabulary (allowed values per field):\n${vocabText}\n\n` +
              `User query: ${q}\n\nReturn the JSON filters now.`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: `AI gateway ${res.status}`, detail: detail.slice(0, 500) }),
        {
          status: res.status === 429 || res.status === 402 ? res.status : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(text);
    const interpreted = parsed ? coerceInterpreted(parsed) : { ...EMPTY, q };

    return new Response(JSON.stringify({ interpreted, model: MODEL }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

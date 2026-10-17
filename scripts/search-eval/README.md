# Search interpreter eval

Scores the AI step of search (`functions/_shared/interpret.ts`) against hand-written queries,
so a prompt or model change is a measurement, not a guess.

```bash
# 1. fetch production's vocabulary rules once (not committed)
npx wrangler d1 execute singlet-catalog --remote --json \
  --command "SELECT field, priority, grp, match_type, pattern FROM vocab_rules ORDER BY field, priority, rowid" \
  | node -e "process.stdout.write(JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8'))[0].results))" \
  > scripts/search-eval/.rules.json

# 2. start the forwarding Worker (uses your wrangler login; remote Workers AI, costs fractions of a cent)
npx wrangler dev --remote --port 8799 --config scripts/search-eval/worker/wrangler.toml

# 3. in another terminal
npm run eval:search -- --prompts v1,v2 --models @cf/meta/llama-4-scout-17b-16e-instruct,@cf/meta/llama-3.3-70b-instruct-fp8-fast
npm run eval:search -- --set golden-nl --prompts v2 --models @cf/meta/llama-4-scout-17b-16e-instruct
```

* `golden.json`: keyword-style queries (what the vocabulary parser mostly answers alone).
* `golden-nl.json`: sentence-style queries (the ones that can reach the model). Its expected `q` terms are
  deliberately synonyms the model may not use; read the `core_fields_*` columns.
* `v1` is the original prompt (about 2,200 input tokens), `v2` the compact one now in production (about 950).
* `--plain 1` skips JSON-schema mode, as production does for models that lack it (Llama 3.1 8B).
* Columns: `fully_right` = raw model output; `after_validation` = after `validateModelReading` + merge;
  `production_flow` = parser alone when it is sure, else validated model reading; `core_fields_*` ignore `q`/`cell_type`.

## Results (2026-10-16)

| model | prompt | input tokens | $ per model call | keyword set (production flow) |
|---|---|---|---|---|
| Llama 3.3 70B | v1 (before) | 2,186 | 0.00080 | 26/39 |
| Llama 3.3 70B | v2 | 1,011 | 0.00046 | 26/39 |
| Mistral Small 3.1 | v2 | 1,016 | 0.00039 | 26/39 |
| **Llama 4 Scout 17B** | **v2 (now)** | **939** | **0.00030** | 26/39 |

Llama 3.1 8B (no JSON-schema mode) scored 13/39 raw, Llama 3.2 3B 1/39, Qwen3 30B burned about 450 output
tokens on reasoning and scored lower, gpt-oss-20b returned nothing usable through the binding.

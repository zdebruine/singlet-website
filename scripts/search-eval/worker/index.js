// POST { model, system, user, schema, maxTokens } -> { result, usage, ms }
// Mirrors functions/_shared/ai.ts runWorkersAi (JSON-schema mode, temperature 0).
export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("POST only", { status: 405 });
    const { model, system, user, schema, maxTokens = 500, plain = false } = await request.json();
    const inputs = {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0,
    };
    if (!plain) inputs.response_format = { type: "json_schema", json_schema: schema };
    const t = Date.now();
    try {
      const out = await env.AI.run(model, inputs);
      return Response.json({ result: out.response ?? out, usage: out.usage ?? null, ms: Date.now() - t });
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 502 });
    }
  },
};

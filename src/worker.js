// Cloudflare Worker (static assets + /api/solve): thin, rate-limited proxy to the Gemini API.
// The key lives in the GEMINI_API_KEY secret on the server and is never sent to the browser.
const hits = new Map(); // best-effort per-IP limiter (per instance)
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

async function solve(request, env) {
  if (!env.GEMINI_API_KEY) return json({ error: 'الخادم غير مُهيّأ: GEMINI_API_KEY مفقود' }, 500);

  const ip = request.headers.get('CF-Connecting-IP') || 'x';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 15) return json({ error: 'طلبات كثيرة، انتظر دقيقة' }, 429);
  recent.push(now);
  hits.set(ip, recent);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'طلب غير صالح' }, 400); }
  const { contents, tools } = body || {};
  if (!Array.isArray(contents) || !contents.length || contents.length > 40)
    return json({ error: 'طلب غير صالح' }, 400);

  const model = env.GEMINI_MODEL || 'gemini-flash-latest';
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents,
          tools: Array.isArray(tools) ? tools.slice(0, 1) : undefined,
          generationConfig: { maxOutputTokens: 8000 }
        })
      }
    );
    const d = await r.json();
    if (!r.ok) return json({ error: (d.error && d.error.message) || 'خطأ من الخدمة' }, r.status === 429 ? 429 : 502);
    return json(d);
  } catch {
    return json({ error: 'تعذّر الاتصال بالخدمة' }, 502);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/solve') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return solve(request, env);
    }
    return env.ASSETS.fetch(request);
  }
};

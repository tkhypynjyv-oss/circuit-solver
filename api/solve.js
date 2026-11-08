// Vercel serverless function: thin, rate-limited proxy to the Anthropic Messages API.
// The API key stays on the server (env var ANTHROPIC_API_KEY) and is never sent to the browser.
const MODEL = process.env.MODEL || 'claude-sonnet-5-5';
const hits = new Map(); // best-effort per-IP limiter (per server instance)

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'الخادم غير مُهيّأ: ANTHROPIC_API_KEY مفقود' });

  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 15) return res.status(429).json({ error: 'طلبات كثيرة، انتظر دقيقة' });
  recent.push(now);
  hits.set(ip, recent);

  const { messages, tools } = req.body || {};
  if (!Array.isArray(messages) || !messages.length || messages.length > 40)
    return res.status(400).json({ error: 'طلب غير صالح' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6000,
        messages,
        tools: Array.isArray(tools) ? tools.slice(0, 3) : undefined
      })
    });
    const d = await r.json();
    if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: (d.error && d.error.message) || 'خطأ من الخدمة' });
    return res.status(200).json(d);
  } catch (e) {
    return res.status(502).json({ error: 'تعذّر الاتصال بالخدمة' });
  }
};

// api/analyze.js — Vercel Serverless Function (ESM format)
// Securely proxies Anthropic API. Your key never reaches the browser.

export default async function handler(req, res) {
  // CORS — required for browser requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle browser CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY not set. Go to Vercel Dashboard → Project → Settings → Environment Variables → Add ANTHROPIC_API_KEY"
    });
  }

  try {
    const body = req.body;
    const system = body?.system || "You are a helpful AI assistant.";
    const messages = body?.messages || [];
    const max_tokens = Math.min(body?.max_tokens || 1500, 2000);

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens,
        system,
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({
        error: `Anthropic error ${response.status}: ${errText.slice(0, 400)}`
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
}

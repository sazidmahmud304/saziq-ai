// api/analyze.js — Vercel Serverless Function
// Securely proxies requests to Anthropic API. Your key never reaches the browser.

export default async function handler(req, res) {
  // ── CORS headers — must be on EVERY response including OPTIONS ──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle browser preflight request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow POST after preflight
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Check API key is configured in Vercel environment variables
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not set. Go to Vercel Dashboard → Your Project → Settings → Environment Variables → Add ANTHROPIC_API_KEY"
    });
  }

  try {
    const { system, messages, max_tokens = 1500 } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid request: messages array required" });
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
        max_tokens: Math.min(max_tokens, 2000), // cap at 2000
        system: system || "You are a helpful AI assistant.",
        messages,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return res.status(response.status).json({
        error: `Anthropic API error ${response.status}: ${errText.slice(0, 500)}`
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
}

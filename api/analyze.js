// api/analyze.js — Vercel Serverless Function (CommonJS)
// Securely proxies Anthropic API. Your API key never reaches the browser.

module.exports = async function handler(req, res) {
  // CORS headers — required for all browser requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle browser preflight (OPTIONS) request
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // Check API key is set in Vercel Environment Variables
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is missing. Go to: Vercel Dashboard → Your Project → Settings → Environment Variables → Add ANTHROPIC_API_KEY = sk-ant-..."
    });
  }

  try {
    const body = req.body || {};
    const system = body.system || "You are a helpful AI assistant.";
    const messages = body.messages || [];
    const max_tokens = Math.min(body.max_tokens || 1500, 2000);

    // Validate messages
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages must be a non-empty array" });
    }

    // Call Anthropic API
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
      console.error("Anthropic API error:", response.status, errText.slice(0, 200));
      return res.status(response.status).json({
        error: "Anthropic API error " + response.status + ": " + errText.slice(0, 300)
      });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    console.error("Server error:", err.message);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

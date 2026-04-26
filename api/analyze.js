// api/analyze.js — Google Gemini API
// Uses gemini-2.5-flash-lite (free tier, 1000 req/day)
// Endpoint: v1beta (required for 2.5 models)

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set in Vercel Environment Variables" });
  }

  try {
    const body = req.body || {};
    const system = body.system || "";
    const messages = body.messages || [];

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Build Gemini contents array
    // System prompt injected as first user/model exchange (works on all versions)
    const geminiContents = [];
    if (system) {
      geminiContents.push({
        role: "user",
        parts: [{ text: "INSTRUCTIONS: " + system }]
      });
      geminiContents.push({
        role: "model",
        parts: [{ text: "Understood. I will follow these instructions." }]
      });
    }
    for (const msg of messages) {
      geminiContents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: String(msg.content) }]
      });
    }

    // gemini-2.5-flash-lite = best free tier (1000 req/day, 15 RPM)
    // MUST use v1beta for 2.5 models
    const model = "gemini-2.5-flash-lite";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 1500,
          temperature: 0.7
        }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let errJson = {};
      try { errJson = JSON.parse(errText); } catch {}
      const msg = errJson?.error?.message || errText.slice(0, 200);

      if (response.status === 429) {
        return res.status(429).json({
          error: "Rate limit reached. Free tier allows 15 requests/min and 1000/day. Wait 1 minute and try again."
        });
      }
      return res.status(response.status).json({
        error: "Gemini error " + response.status + ": " + msg
      });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
      return res.status(500).json({ error: "Empty response from Gemini. Try again." });
    }

    // Return in Anthropic-compatible format — App.jsx works without any changes
    return res.status(200).json({
      content: [{ type: "text", text }]
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

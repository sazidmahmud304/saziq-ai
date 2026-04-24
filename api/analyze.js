// api/analyze.js — Google Gemini API (Free: 1500 requests/day)
// Free key at: aistudio.google.com

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY not set in Vercel Environment Variables"
    });
  }

  try {
    const body = req.body || {};
    const system = body.system || "You are a helpful AI assistant.";
    const messages = body.messages || [];

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Convert to Gemini format
    const geminiContents = messages.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: String(msg.content) }]
    }));

    // Try models in order until one works
    const models = [
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash-latest",
      "gemini-pro"
    ];

    let lastError = "";
    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: geminiContents,
            generationConfig: { maxOutputTokens: 2000, temperature: 0.7 }
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${model}: ${response.status} ${errText.slice(0, 100)}`;
          continue; // try next model
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        if (!text) {
          lastError = `${model}: empty response`;
          continue;
        }

        // Success — return in Anthropic-compatible format
        return res.status(200).json({
          content: [{ type: "text", text }]
        });

      } catch (modelErr) {
        lastError = `${model}: ${modelErr.message}`;
        continue;
      }
    }

    // All models failed
    return res.status(500).json({
      error: "All Gemini models failed. Last error: " + lastError
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

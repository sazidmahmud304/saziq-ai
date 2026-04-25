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
    return res.status(500).json({ error: "GEMINI_API_KEY not set in Vercel Environment Variables" });
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

    // Use v1 (stable) not v1beta — works with all current Gemini models
    // gemini-2.0-flash is free and fast
    const model = "gemini-2.0-flash";
    const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.7
        }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini error:", response.status, errText.slice(0, 300));
      return res.status(response.status).json({
        error: "Gemini API error " + response.status + ": " + errText.slice(0, 400)
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
    console.error("Server error:", err.message);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

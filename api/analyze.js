// api/analyze.js — Uses Google Gemini API (Free tier: 1500 requests/day)
// Get your free key at: aistudio.google.com

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY not set. Go to Vercel Dashboard → Project → Settings → Environment Variables → Add GEMINI_API_KEY"
    });
  }

  try {
    const body = req.body || {};
    const system = body.system || "You are a helpful AI assistant.";
    const messages = body.messages || [];

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Convert Anthropic message format to Gemini format
    const geminiContents = messages.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    // Call Gemini 1.5 Flash (free, fast, powerful)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents: geminiContents,
        generationConfig: {
          maxOutputTokens: 2000,
          temperature: 0.7,
        }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText.slice(0, 200));
      return res.status(response.status).json({
        error: "Gemini API error " + response.status + ": " + errText.slice(0, 300)
      });
    }

    const data = await response.json();

    // Extract text from Gemini response
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
      return res.status(500).json({ error: "No response from Gemini. Try again." });
    }

    // Return in Anthropic-compatible format so App.jsx doesn't need changes
    return res.status(200).json({
      content: [{ type: "text", text }]
    });

  } catch (err) {
    console.error("Server error:", err.message);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

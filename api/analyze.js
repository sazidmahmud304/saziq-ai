// api/analyze.js — Google Gemini API (Updated for latest models)

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

    // ✅ Updated models (latest working priority)
    const models = [
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest"
    ];

    let lastError = "";
    for (const model of models) {
      try {
        // ✅ FIX: Updated endpoint (v1 instead of v1beta)
        const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // ✅ FIX: system_instruction format updated
            const geminiContents = [
  {
    role: "user",
    parts: [
      { text: system + "\n\n" + messages.map(m => m.content).join("\n") }
    ]
  }
];
            contents: geminiContents,
            generationConfig: {
              maxOutputTokens: 2000,
              temperature: 0.7
            }
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          lastError = `${model}: ${response.status} ${errText.slice(0, 100)}`;
          continue;
        }

        const data = await response.json();

        // ✅ FIX: safer response parsing
        const text =
          data?.candidates?.[0]?.content?.parts
            ?.map(p => p.text)
            .join("") || "";

        if (!text) {
          lastError = `${model}: empty response`;
          continue;
        }

        return res.status(200).json({
          content: [{ type: "text", text }]
        });

      } catch (modelErr) {
        lastError = `${model}: ${modelErr.message}`;
        continue;
      }
    }

    return res.status(500).json({
      error: "All Gemini models failed. Last error: " + lastError
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

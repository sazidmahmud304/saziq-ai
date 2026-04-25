// api/analyze.js — Google Gemini API with retry logic
// Free tier: gemini-2.0-flash-lite has highest free quota

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

    // Build contents — inject system as first exchange
    const geminiContents = [];
    if (system) {
      geminiContents.push({
        role: "user",
        parts: [{ text: "INSTRUCTIONS: " + system }]
      });
      geminiContents.push({
        role: "model",
        parts: [{ text: "Understood. I will follow these instructions carefully." }]
      });
    }
    for (const msg of messages) {
      geminiContents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: String(msg.content) }]
      });
    }

    // Try models from highest to lowest free quota
    // gemini-2.0-flash-lite: 30 req/min, 1500/day FREE
    // gemini-2.0-flash:      15 req/min, 1500/day FREE  
    // gemini-1.5-flash-8b:   15 req/min, 1500/day FREE
    const models = [
      "gemini-2.0-flash-lite",
      "gemini-2.0-flash",
      "gemini-1.5-flash-8b"
    ];

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${apiKey}`;

      // Try each model up to 2 times with a short wait
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          if (attempt === 2) await sleep(3000); // wait 3s before retry

          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: geminiContents,
              generationConfig: {
                maxOutputTokens: 2000,
                temperature: 0.7
              }
            }),
          });

          if (response.status === 429) {
            // Rate limited — try next model
            break;
          }

          if (!response.ok) {
            const errText = await response.text();
            // If 404 model not found, try next model
            if (response.status === 404) break;
            return res.status(response.status).json({
              error: "Gemini error " + response.status + ": " + errText.slice(0, 300)
            });
          }

          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

          if (!text) continue; // try again

          // Success!
          return res.status(200).json({
            content: [{ type: "text", text }]
          });

        } catch (fetchErr) {
          if (attempt === 2) break; // move to next model
        }
      }
    }

    // All models rate limited
    return res.status(429).json({
      error: "API rate limit reached. Please wait 1 minute and try again. (Free tier: 30 requests/minute)"
    });

  } catch (err) {
    return res.status(500).json({ error: "Server error: " + err.message });
  }
};

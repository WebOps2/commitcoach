import 'dotenv/config';
import express from "express";
import rateLimit from "express-rate-limit";
// import fetch from "node-fetch";

const app = express();
app.use(express.json());

// limit abuse: 60 requests/minute per IP
app.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));

app.post("/v1/commitcoach", async (req, res) => {
  const { diff } = req.body || {};
  if (!diff) return res.status(400).json({ error: "diff required" });

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          { role: "system", content: "You write concise, conventional commit messages." },
          { role: "user", content: `Generate a commit message for this diff:\n\n${diff}` }
        ]
      })
    });

    if (!r.ok) {
      const text = await r.text();
      return res.status(502).json({ error: `OpenAI error: ${text}` });
    }

    const data = await r.json();
    res.json({ message: data.output_text?.trim() || "chore: update" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.listen(8080, () => {
  console.log("CommitCoach proxy running on http://localhost:8080");
});

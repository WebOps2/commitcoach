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
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: "You write one-line Conventional Commit messages (<=72 chars)." },
      { role: "user", content: `Generate a Conventional Commit message for this staged diff:\n\n${diff}` }
    ]
  }),
});

if (!r.ok) return res.status(502).json({ error: `OpenAI error ${r.status}: ${await r.text()}` });
const data = await r.json();
const text = data.choices?.[0]?.message?.content?.trim() || "";
res.json({ message: text || "chore: update" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

app.listen(8080, () => {
  console.log("CommitCoach proxy running on http://localhost:8080");
});

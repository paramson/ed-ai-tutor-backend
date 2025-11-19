import OpenAI from "openai";
import fetch from "node-fetch";
import fs from "fs/promises";
import path from "path";

export const config = {
  api: {
    bodyParser: true,
  },
};

// -----------------------------
// Load Instruction File
// -----------------------------
async function loadInstructions() {
  const filePath = path.join(
    process.cwd(),
    "instructions",
    "ED_AI_TUTOR_Instructions_v2025_14.txt"
  );
  return await fs.readFile(filePath, "utf-8");
}

// -----------------------------
// Load Engines
// -----------------------------
async function loadEngines() {
  const enginesDir = path.join(process.cwd(), "engines");
  const engineFiles = await fs.readdir(enginesDir);

  const engines = {};
  for (const file of engineFiles) {
    const filePath = path.join(enginesDir, file);
    const content = await fs.readFile(filePath, "utf-8");
    engines[file.replace(".json", "")] = JSON.parse(content);
  }
  return engines;
}

// -----------------------------
// GitHub Fetch Function
// -----------------------------
async function fetchGithubGuideline(query) {
  const repo = "paramson/edaitutor-reference-library";
  const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(
    query
  )}+repo:${repo}`;

  const results = await fetch(searchUrl).then((res) => res.json());
  if (!results.items || results.items.length === 0) return null;

  const file = results.items[0];
  const fileData = await fetch(file.url).then((res) => res.json());
  const decoded = Buffer.from(fileData.content, "base64").toString("utf-8");
  return decoded;
}

// --------------------------------------------------
// MAIN HANDLER — NOW STREAMING FOR YOUR FRONTEND
// --------------------------------------------------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  const { message, model = "gpt-4.1", engine = "None" } = req.body;

  if (!message)
    return res.status(400).json({ error: "Message is required" });

  // Load resources
  const systemInstructions = await loadInstructions();
  const engines = await loadEngines();
  const guideline = await fetchGithubGuideline(
    message.split(" ").slice(0, 5).join(" ")
  );

  // Build context
  const context = `
${systemInstructions}

=== ENGINE SETTINGS ===
${JSON.stringify(engines, null, 2)}

=== AUTO-RETRIEVED GUIDELINE ===
${guideline || "No guideline found"}

=== USER QUESTION ===
${message}
`;

  // Set streaming headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // -----------------------------
  // STREAM FROM OPENAI
  // -----------------------------
  const completion = await openai.chat.completions.create({
    model,
    stream: true,
    messages: [
      { role: "system", content: context },
      { role: "user", content: message },
    ],
    temperature: 0.2,
  });

  // Send tokens as SSE
  for await (const chunk of completion) {
    const token = chunk?.choices?.[0]?.delta?.content;

    if (token) {
      res.write(`data: ${token}\n\n`);
    }
  }

  // End
  res.write("data: [END]\n\n");
  res.end();
}

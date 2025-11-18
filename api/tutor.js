import OpenAI from "openai";
import fetch from "node-fetch";
import fs from "fs/promises";
import path from "path";

// -----------------------------
//  Load Instruction File
// -----------------------------
async function loadInstructions() {
  const filePath = path.join(process.cwd(), "instructions", "ED_AI_TUTOR_Instructions_v2025_14.txt");
  return await fs.readFile(filePath, "utf-8");
}

// -----------------------------
//  Load Engines
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
  const searchUrl =
    `https://api.github.com/search/code?q=${encodeURIComponent(
      query
    )}+repo:${repo}`;

  const results = await fetch(searchUrl).then((res) => res.json());

  if (!results.items || results.items.length === 0) return null;

  const file = results.items[0];
  const fileData = await fetch(file.url).then((res) => res.json());

  const decoded = Buffer.from(fileData.content, "base64").toString("utf-8");
  return decoded;
}

// -----------------------------
//    MAIN API ROUTE
// -----------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message" });

  // Load core components
  const systemInstructions = await loadInstructions();
  const engines = await loadEngines();

  // Auto-detect GitHub search term
  const keyword = message.split(" ").slice(0, 5).join(" ");
  const guideline = await fetchGithubGuideline(keyword);

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Build final context
  const context = `
${systemInstructions}

=== ENGINES ===
${JSON.stringify(engines, null, 2)}

=== AUTO-RETRIEVED GITHUB GUIDELINE ===
${guideline || "No guideline found"}

=== USER QUESTION ===
${message}
`;

  // Call OpenAI
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1",
    messages: [
      { role: "system", content: context },
      { role: "user", content: message },
    ],
    temperature: 0.2
  });

  const reply = completion.choices[0].message.content;

  return res.status(200).json({ reply });
}


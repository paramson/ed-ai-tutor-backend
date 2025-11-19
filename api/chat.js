// /api/chat.js — FINAL STABLE BACKEND (ED AI Tutor v2025.14)

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -----------------------------
// Load Instruction File
// -----------------------------
async function loadInstructions() {
  try {
    const filePath = path.join(
      process.cwd(),
      "instructions",
      "ED_AI_TUTOR_Instructions_v2025_14_CLEAN.txt"
    );
    return await fs.readFile(filePath, "utf-8");
  } catch (err) {
    console.error("❌ Failed to load instructions file:", err);
    throw new Error("Instruction file missing.");
  }
}

// -----------------------------
// Load Engines Folder
// -----------------------------
async function loadEngines() {
  const enginesDir = path.join(process.cwd(), "engines");
  let files = [];

  try {
    files = await fs.readdir(enginesDir);
  } catch (err) {
    console.warn("⚠️ No engines folder found:", err.message);
    return {};
  }

  const engines = {};

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(enginesDir, file);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      engines[file.replace(".json", "")] = parsed;
    } catch (err) {
      console.warn(`⚠️ Failed to load engine ${file}:`, err.message);
    }
  }

  return engines;
}

// -----------------------------
// Extract plain text from Responses API
// -----------------------------
function extractText(response) {
  try {
    // 🔧 FIX: make *response itself* optional
    const blocks = response?.output?.[0]?.content || [];

    for (const block of blocks) {
      if (typeof block.text === "string") return block.text;
      if (block.output_text?.text) return block.output_text.text;
    }
  } catch (err) {
    console.warn("⚠️ Failed to extract text from response:", err.message);
  }

  return "";
}

// -----------------------------
// MAIN HANDLER WITH CORS
// -----------------------------
export default async function handler(req, res) {
  const allowedOrigins = [
    "https://edaitutor.org",
    "https://www.edaitutor.org",
    "https://ed-ai-tutor-frontend.vercel.app"
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // OPTIONS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Allow only POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Invalid or missing message." });
  }

  try {
    const [instructions, engines] = await Promise.all([
      loadInstructions(),
      loadEngines()
    ]);

    const input = [
      {
        role: "user",
        content: [
          { type: "input_text", text: message },
          {
            type: "input_text",
            text:
              "\n\n[ED AI Tutor Engines]\n" +
              JSON.stringify(engines, null, 2),
          },
        ],
      },
    ];

    const aiResponse = await client.responses.create({
      model: "gpt-4.1",
      instructions,
      input,
    });

    const outputText = extractText(aiResponse);

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(outputText);
  } catch (err) {
    console.error("❌ ERROR in /api/chat:", err);
    return res.status(500).json({
      error: "Internal server error.",
      message: err.message,
    });
  }
}

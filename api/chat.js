// /api/chat.js — FINAL BACKEND (ED AI Tutor v2025.14)
// Node.js on Vercel — ESM syntax

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

// -----------------------------
// OpenAI Client
// -----------------------------
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// -----------------------------
// Load Instructions File
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
// Load Engines Folder (all JSON)
// -----------------------------
async function loadEngines() {
  const enginesDir = path.join(process.cwd(), "engines");
  let files = [];

  try {
    files = await fs.readdir(enginesDir);
  } catch (err) {
    console.warn("⚠ No engines folder found:", err.message);
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
      console.warn(`⚠ Failed to load engine ${file}:`, err.message);
    }
  }

  return engines;
}

// -----------------------------
// Extract text from Responses API output
// -----------------------------
function extractText(response) {
  try {
    const blocks = response.output?.[0]?.content || [];
    for (const block of blocks) {
      if (typeof block.text === "string") return block.text;
      if (block.output_text?.text) return block.output_text.text;
    }
  } catch (_) {}

  return "";
}

// -----------------------------
// Route Handler (POST only)
// -----------------------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body || {};

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing or invalid message." });
  }

  try {
    // Load instructions + engines together
    const [instructions, engines] = await Promise.all([
      loadInstructions(),
      loadEngines(),
    ]);

    // Build request payload for Responses API
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

    // Call OpenAI Responses API
    const aiResponse = await client.responses.create({
      model: "gpt-5.1", // Change to "gpt-4.1" or "gpt-4.1-mini" if needed
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

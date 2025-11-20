// /api/chat.js — FINAL FIXED BACKEND (ED AI Tutor v2025.14)

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

// -----------------------------
// Load Instruction File
// -----------------------------
async function loadInstructions() {
  const filePath = path.join(
    process.cwd(),
    "instructions",
    "ED_AI_TUTOR_Instructions_v2025_14_CLEAN.txt"
  );
  return await fs.readFile(filePath, "utf-8");
}

// -----------------------------
// Load Engines Folder
// -----------------------------
async function loadEngines() {
  const enginesDir = path.join(process.cwd(), "engines");
  const engines = {};

  try {
    const files = await fs.readdir(enginesDir);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const raw = await fs.readFile(path.join(enginesDir, file), "utf-8");
        engines[file.replace(".json", "")] = JSON.parse(raw);
      }
    }
  } catch {
    console.warn("⚠️ Engines folder not found");
  }

  return engines;
}

// -----------------------------
// MAIN HANDLER
// -----------------------------
export default async function handler(req, res) {
  // CORS
  const allowedOrigins = [
    "https://edaitutor.org",
    "https://www.edaitutor.org",
    "https://ed-ai-tutor-frontend.vercel.app"
  ];

  if (allowedOrigins.includes(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Extract message
  const { message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: "Missing message" });
  }

  // Load API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("❌ Missing OPENAI_API_KEY");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  const client = new OpenAI({ apiKey });

  try {
    const [instructions, engines] = await Promise.all([
      loadInstructions(),
      loadEngines()
    ]);

    // -----------------------------
    // VALID Responses API payload
    // -----------------------------
    const aiResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                message +
                "\n\n[ED AI Tutor Engines]\n" +
                JSON.stringify(engines, null, 2)
            }
          ]
        }
      ]
    });

    // -----------------------------
    // Extract text output safely
    // -----------------------------
    let outputText = "";

    const outputs = aiResponse?.output || [];
    for (const item of outputs) {
      for (const block of item.content || []) {
        if (block.type === "output_text" && block.text) {
          outputText += block.text;
        }
        if (block.output_text?.text) {
          outputText += block.output_text.text;
        }
      }
    }

    if (!outputText) outputText = "No response generated.";

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(outputText);
  } catch (err) {
    console.error("❌ Backend error:", err);
    return res.status(500).json({ error: err.message });
  }
}

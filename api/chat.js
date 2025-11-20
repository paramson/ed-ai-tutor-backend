// /api/chat.js — FIXED BACKEND

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

// Load instructions
async function loadInstructions() {
  const filePath = path.join(
    process.cwd(),
    "instructions",
    "ED_AI_TUTOR_Instructions_v2025_14_CLEAN.txt"
  );
  return await fs.readFile(filePath, "utf-8");
}

// Load engines
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
  } catch (e) {
    console.warn("No engines folder");
  }

  return engines;
}

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

  const { message } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Missing message" });
  }

  // FIX #1 — correct env lookup
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY missing");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  // FIX #2 — valid OpenAI client
  const client = new OpenAI({ apiKey });

  try {
    const [instructions, engines] = await Promise.all([
      loadInstructions(),
      loadEngines()
    ]);

    const aiResponse = await client.responses.create({
      model: "gpt-4.1-mini",
      instructions,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: message },
            {
              type: "input_text",
              text: "\n\n[ED AI Tutor Engines]\n" + JSON.stringify(engines, null, 2)
            }
          ]
        }
      ]
    });

    // Extract text
    let output = "";

    const outputs = aiResponse?.output ?? [];
    for (const item of outputs) {
      for (const block of item?.content ?? []) {
        if (block.text) output += block.text;
        if (block.output_text?.text) output += block.output_text.text;
      }
    }

    return res.status(200).send(output || "No response generated.");
  } catch (err) {
    console.error("❌ Backend error:", err);
    return res.status(500).json({ error: err.message });
  }
}

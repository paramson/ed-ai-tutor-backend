// /api/chat.js — STABLE BACKEND USING CHAT COMPLETIONS

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
      if (!file.endsWith(".json")) continue;

      const raw = await fs.readFile(path.join(enginesDir, file), "utf-8");
      engines[file.replace(".json", "")] = JSON.parse(raw);
    }
  } catch (err) {
    console.warn("⚠️ No engines folder found:", err.message);
  }

  return engines;
}

// -----------------------------
// MAIN HANDLER WITH CORS
// -----------------------------
export default async function handler(req, res) {
  const allowedOrigins = [
    "https://edaitutor.org",
    "https://www.edaitutor.org",
    "https://ed-ai-tutor-frontend.vercel.app",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message } = req.body || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing or invalid message" });
  }

  // ✅ Correct env lookup
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("❌ OPENAI_API_KEY missing");
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  // ✅ Stable OpenAI client
  const client = new OpenAI({ apiKey });

  try {
    const [instructions, engines] = await Promise.all([
      loadInstructions(),
      loadEngines(),
    ]);

    // Build system prompt: instructions + engines JSON
    const systemPrompt =
      instructions +
      "\n\n[ED AI Tutor Engines JSON]\n" +
      JSON.stringify(engines, null, 2);

    // ✅ Use classic chat completions API
    const completion = await client.chat.completions.create({
      model: "gpt-4.1-mini", // or "gpt-4o-mini" / "gpt-4.1" if available
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.3,
    });

    const output =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "No response generated.";

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(output);
  } catch (err) {
    console.error("❌ Backend error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
}

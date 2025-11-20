// /api/chat.js — FIXED STREAMING BACKEND (ED AI Tutor v2025.14)

import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

async function loadInstructions() {
  const filePath = path.join(
    process.cwd(),
    "instructions",
    "ED_AI_TUTOR_Instructions_v2025_14_CLEAN.txt"
  );
  return await fs.readFile(filePath, "utf-8");
}

async function loadEngines() {
  const enginesDir = path.join(process.cwd(), "engines");
  let files = [];

  try {
    files = await fs.readdir(enginesDir);
  } catch {
    return {};
  }

  const engines = {};
  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    try {
      const raw = await fs.readFile(
        path.join(enginesDir, file),
        "utf-8"
      );
      engines[file.replace(".json", "")] = JSON.parse(raw);
    } catch {}
  }

  return engines;
}

export default async function handler(req, res) {
  // CORS
  const allowed = [
    "https://edaitutor.org",
    "https://www.edaitutor.org",
    "https://ed-ai-tutor-frontend.vercel.app",
  ];

  if (allowed.includes(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message" });

  // Load env KEY
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
  }

  const client = new OpenAI({ apiKey });

  try {
    const [instructions, engines] = await Promise.all([
      loadInstructions(),
      loadEngines(),
    ]);

    // Response headers for SSE streaming
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

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

    // STREAMING MODE
    const stream = await client.responses.stream({
      model: "gpt-4.1-mini",
      instructions,
      input,
    });

    // Pipe tokens directly to frontend
    stream.on("content.delta", (delta) => {
      if (delta?.text) {
        res.write(`data: ${delta.text}\n\n`);
      }
    });

    stream.on("end", () => {
      res.write("data: [END]\n\n");
      res.end();
    });

    stream.on("error", (err) => {
      console.error("❌ Stream error:", err);
      try {
        res.write("data: [END]\n\n");
        res.end();
      } catch {}
    });
  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

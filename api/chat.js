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
    if (!file.endsWith(".json")) continue;
    const filePath = path.join(enginesDir, file);
    const content = await fs.readFile(filePath, "utf-8");
    engines[file.replace(".json", "")] = JSON.parse(content);
  }
  return engines;
}

// -----------------------------
// GitHub Guideline Retrieval
// -----------------------------
const GITHUB_REPO = "paramson/edaitutor-reference-library";

async function searchGithubGuidelines(message, maxFiles = 3) {
  try {
    // Simple keyword extraction from user message
    const words = message.split(/\s+/).slice(0, 12);
    const keywords = words.join(" ");

    const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(
      keywords
    )}+repo:${GITHUB_REPO}&per_page=${maxFiles}`;

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      console.error("GitHub search error:", searchRes.status, await searchRes.text());
      return [];
    }

    const results = await searchRes.json();
    if (!results.items || results.items.length === 0) return [];

    const guidelines = [];

    for (const item of results.items.slice(0, maxFiles)) {
      try {
        const fileRes = await fetch(item.url);
        if (!fileRes.ok) {
          console.error("GitHub file fetch error:", item.path, fileRes.status);
          continue;
        }

        const fileData = await fileRes.json();
        if (!fileData.content) continue;

        const decoded = Buffer.from(fileData.content, "base64").toString("utf-8");

        // Optional: truncate very large files to keep token usage reasonable
        const MAX_CHARS = 8000;
        const truncatedContent =
          decoded.length > MAX_CHARS ? decoded.slice(0, MAX_CHARS) + "\n\n...[truncated]" : decoded;

        guidelines.push({
          path: item.path,
          content: truncatedContent,
        });
      } catch (err) {
        console.error("Error decoding GitHub file:", item.path, err);
      }
    }

    return guidelines;
  } catch (error) {
    console.error("GitHub guideline search failed:", error);
    return [];
  }
}

// -----------------------------
// Build System Prompt
// -----------------------------
function buildSystemPrompt({
  systemInstructions,
  engines,
  githubGuidelines,
  userMessage,
  activeEngine,
}) {
  const engineList = Object.keys(engines || {});
  const activeEngineNote =
    activeEngine && engineList.includes(activeEngine)
      ? `ACTIVE ENGINE: ${activeEngine} (prioritise this engine's logic when relevant).`
      : "No specific engine selected by user — use all relevant engines collaboratively.";

  const referencedModules =
    githubGuidelines.length > 0
      ? githubGuidelines.map((g) => `• ${g.path}`).join("\n")
      : "None found (fallback to engines + core reasoning).";

  const guidelinesContent =
    githubGuidelines.length > 0
      ? githubGuidelines
          .map(
            (g, idx) =>
              `--- GitHub Module ${idx + 1}: ${g.path} ---\n${g.content}`
          )
          .join("\n\n")
      : "No GitHub guideline content retrieved. Use engines + generic guideline knowledge, but state that GitHub modules were not available.";

  return `
${systemInstructions}

====================================================
ED AI TUTOR – BACKEND ORCHESTRATION LAYER (SERVER)
====================================================

You are running in BACKEND MODE. Always follow these orchestration rules:

1) STEPWISE CLINICAL REASONING
   • Start with pattern recognition from the case.
   • Generate key differentials (common / serious / rare).
   • Highlight red flags → if present, clearly state:
     "🔴 PRIORITY: ABCDE FIRST – RESUSCITATION TAKES PRIORITY OVER DIAGNOSTICS."
   • Perform risk stratification (low / moderate / high).
   • Structure the answer as:
     - Initial Assessment & ABCDE
     - Differentials
     - Risk Stratification
     - Investigations (bedside → labs → imaging)
     - Management (time-critical → core ED care → adjuncts)
     - Disposition
     - Safety-netting

2) ENGINE INTEGRATION
   • Available local engines: ${engineList.join(", ") || "none detected"}.
   • ${activeEngineNote}
   • Never contradict engine logic. If conflict arises, favour the safer, more conservative path.

3) GITHUB GUIDELINE INTEGRATION (MANDATORY WHEN AVAILABLE)
   • Referenced GitHub Modules (auto-retrieved by backend):
${referencedModules}

   • Use these modules as primary guideline sources when relevant.
   • Extract algorithms, red flags, investigations, dosing, and disposition guidance from them.
   • Explicitly cite them in the answer under:
     "Referenced GitHub Modules: <file>"

4) OUTPUT FORMAT FOR CLINICAL CASES
   • Use clear headings and bullet points.
   • Explicitly signpost red flags with 🔴.
   • Use confidence icons where appropriate:
     - 🟢 high confidence
     - 🟡 moderate/uncertain
     - ⚪ low/limited evidence
   • Finish EVERY clinical answer with:
     a) "Referenced GitHub Modules" (list the module paths used, or "None available")
     b) "International Guideline References (general, not patient-specific):"
        - AU: RCH Clinical Guidelines / ACI NSW
        - NZ: Starship Clinical Guidelines
        - UK: NICE / RCEM
        - USA: ACEP / AAP
        - CAN: CAEP

5) OPTIONAL FOLLOW-UP MODE (BACKEND ENFORCED)
   • After completing the clinical answer, append:
     "Would you like:
       1) ACEM-style exam practice based on this case (MCQ / SAQ / Viva), or
       2) 1–2 key recent papers/guideline updates with brief PICO-style summaries?"
   • Do NOT generate questions or research summaries until the user explicitly says yes.

====================================================
AUTO-RETRIEVED GITHUB GUIDELINE CONTENT
(Already fetched by backend – do NOT call APIs yourself)
====================================================
${guidelinesContent}

====================================================
USER QUESTION (FOR CONTEXT)
====================================================
${userMessage}
`;
}

// --------------------------------------------------
// MAIN HANDLER — STREAMING FOR YOUR FRONTEND
// --------------------------------------------------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  try {
    const { message, model = "gpt-4.1-mini", engine = "None" } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    // Load resources in parallel
    const [systemInstructions, engines, githubGuidelines] = await Promise.all([
      loadInstructions(),
      loadEngines(),
      searchGithubGuidelines(message, 3),
    ]);

    const systemPrompt = buildSystemPrompt({
      systemInstructions,
      engines,
      githubGuidelines,
      userMessage: message,
      activeEngine: engine,
    });

    // Set streaming headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore – some runtimes support flush
    if (res.flushHeaders) res.flushHeaders();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // STREAM FROM OPENAI
    const completion = await openai.chat.completions.create({
      model,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      temperature: 0.2,
    });

    for await (const chunk of completion) {
      const token = chunk?.choices?.[0]?.delta?.content;
      if (token) {
        res.write(`data: ${token}\n\n`);
      }
    }

    res.write("data: [END]\n\n");
    res.end();
  } catch (error) {
    console.error("Handler error:", error);
    try {
      res.write(
        `data: [SERVER ERROR] An error occurred while generating the response.\n\n`
      );
      res.write("data: [END]\n\n");
      res.end();
    } catch {
      // If streaming already broken, just end silently
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
}

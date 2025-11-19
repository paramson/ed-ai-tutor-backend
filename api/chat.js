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
// Build System Prompt (Markdown + icons)
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
      ? githubGuidelines.map((g) => `- \`${g.path}\``).join("\n")
      : "- None found (fallback to engines + core reasoning).";

  const guidelinesContent =
    githubGuidelines.length > 0
      ? githubGuidelines
          .map(
            (g, idx) =>
              `### 📄 GitHub Module ${idx + 1}: \`${g.path}\`\n\n` +
              "```text\n" +
              g.content +
              "\n```"
          )
          .join("\n\n---\n\n")
      : "_No GitHub guideline content retrieved for this query. Use local engines + general guideline knowledge, and clearly state that GitHub modules were not available._";

  return `
${systemInstructions}

---

You are running in **BACKEND ORCHESTRATION MODE** for ED AI Tutor.

You **MUST** format all clinical answers using **clean GitHub-flavoured Markdown** with clear section headings and clinical icons.

Use this exact structure (adapt names to the case):

## 🧠 STEPWISE CLINICAL REASONING (Short Title – e.g. Chest Pain – ACS Pathway)

### 📁 Referenced GitHub Modules
${referencedModules}

---

### ⚠️ PRIORITY: ABCDE FIRST
- **Airway:** ...
- **Breathing:** ...
- **Circulation:** ...
- **Disability:** ...
- **Exposure:** ...

If unstable → clearly state:  
\`If unstable, immediate resuscitation in resus bay takes priority over diagnostics.\`

---

### 1️⃣ INITIAL DIFFERENTIAL DIAGNOSIS
**Common**
- ...

**Serious – must not miss**
- ...

**Rare / other**
- ...

---

### 2️⃣ 🧪 INVESTIGATIONS
**Bedside**
- ...

**Laboratory**
- ...

**Imaging**
- ...

---

### 3️⃣ 💊 EMERGENCY DEPARTMENT MANAGEMENT
**Time-critical / resuscitation**
- ...

**Core ED care**
- ...

**Adjuncts**
- ...

---

### 4️⃣ 🚑 DISPOSITION
- Admit vs discharge criteria
- Ward / HDU / ICU / theatre
- Follow-up and referrals

---

### 5️⃣ 🛡️ SAFETY-NETTING & PATIENT EDUCATION
- Red flags to return
- Expected course
- Written/ verbal instructions

---

### 📚 Referenced GitHub Modules
${referencedModules}

### 🌍 International Guideline References (general, not patient-specific)
- AU: RCH Clinical Guidelines / ACI NSW  
- NZ: Starship Clinical Guidelines  
- UK: NICE / RCEM  
- USA: ACEP / AAP  
- CAN: CAEP  

---

### 🔄 Optional Follow-Up (you must append this text verbatim)
At the end of every clinical case answer, append:

> Would you like:
> 1) ACEM-style exam practice based on this case (MCQ / SAQ / Viva), or  
> 2) 1–2 key recent papers or guideline updates with brief PICO-style summaries?

Do **not** generate exam questions or research content unless the user explicitly says yes.

---

### ENGINE INTEGRATION (INTERNAL)
Available engines: ${engineList.join(", ") || "none detected"}  
${activeEngineNote}

Use the engines plus the GitHub modules **before** answering. Never contradict engine logic.

---

### PRE-FETCHED GITHUB GUIDELINE CONTENT (READ & INTEGRATE, DO NOT CALL APIs)
${guidelinesContent}

---

### USER QUESTION (FOR CONTEXT)
${userMessage}
`;
}

// --------------------------------------------------
// MAIN HANDLER — STREAMING FOR FRONTEND
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

    // Streaming headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore
    if (res.flushHeaders) res.flushHeaders();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
        // send raw tokens; frontend handles markdown + spacing
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
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
}

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
// CONSTANTS
// -----------------------------
const GITHUB_REPO = "paramson/edaitutor-reference-library";

// -----------------------------
// LOAD INSTRUCTIONS
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
// LOAD ENGINES
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
// GITHUB GUIDELINE SEARCH
// -----------------------------
async function searchGithubGuidelines(message, maxFiles = 3) {
  try {
    const words = message.split(/\s+/).slice(0, 12);
    const keywords = words.join(" ");

    const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(
      keywords
    )}+repo:${GITHUB_REPO}&per_page=${maxFiles}`;

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      console.error(
        "GitHub search error:",
        searchRes.status,
        await searchRes.text()
      );
      return [];
    }

    const results = await searchRes.json();
    if (!results.items || results.items.length === 0) return [];

    const guidelines = [];

    for (const item of results.items.slice(0, maxFiles)) {
      try {
        const fileRes = await fetch(item.url);
        if (!fileRes.ok) {
          console.error(
            "GitHub file fetch error:",
            item.path,
            fileRes.status
          );
          continue;
        }

        const fileData = await fileRes.json();
        if (!fileData.content) continue;

        const decoded = Buffer.from(fileData.content, "base64").toString(
          "utf-8"
        );

        const MAX_CHARS = 8000;
        const truncatedContent =
          decoded.length > MAX_CHARS
            ? decoded.slice(0, MAX_CHARS) + "\n\n...[truncated]"
            : decoded;

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
// BUILD CONTEXT BLOCK (ENGINES + GITHUB)
// -----------------------------
function buildContextBlock(engines, githubGuidelines) {
  const engineList = Object.keys(engines || {});
  const engineSection =
    engineList.length > 0
      ? `Available engines:\n- ${engineList.join("\n- ")}`
      : "No engines detected.";

  const modulesList =
    githubGuidelines.length > 0
      ? githubGuidelines.map((g) => `- ${g.path}`).join("\n")
      : "- None found (fallback to engines + core reasoning).";

  const modulesContent =
    githubGuidelines.length > 0
      ? githubGuidelines
          .map(
            (g, idx) =>
              `### GitHub Module ${idx + 1}: ${g.path}\n\n\`\`\`text\n${g.content}\n\`\`\``
          )
          .join("\n\n---\n\n")
      : "_No GitHub guideline content retrieved for this query. Use local engines + general guideline knowledge, and clearly state that GitHub modules were not available._";

  return `
[ENGINE CONTEXT]
${engineSection}

[REFERENCED GITHUB MODULES]
${modulesList}

[RAW GITHUB CONTENT – READ & INTEGRATE, DO NOT CALL APIs]
${modulesContent}
`;
}

// -----------------------------
// MARKDOWN TEMPLATE MESSAGE
// -----------------------------
const MARKDOWN_TEMPLATE = `
You MUST format ALL clinical answers in the following EXACT style, using **clean GitHub-flavoured Markdown**.

You MUST preserve headings, blank lines, and bullet structure.

--------------------------------------------------
## 🧠 STEPWISE CLINICAL REASONING ({AutoTitle})
--------------------------------------------------

Start with 1–2 sentences summarising the case and pattern recognition. Replace {AutoTitle} with a concise, case-specific pathway title (e.g. "Adult Chest Pain – ACS Pathway", "Paediatric Asthma Exacerbation").

---

### 📁 Referenced GitHub Modules
- {module 1}
- {module 2}
- {module 3}

(Replace with the actual modules you used, or "None" if not applicable.)

---

### ⚠️ PRIORITY: ABCDE FIRST

**Airway**  
- ...

**Breathing**  
- ...

**Circulation**  
- ...

**Disability**  
- ...

**Exposure**  
- ...

If unstable, clearly state:  
**"If unstable, immediate resuscitation in the resus bay takes priority over diagnostics."**

---

## 1️⃣ INITIAL DIFFERENTIAL DIAGNOSIS

### Common  
- ...

### Serious – must not miss  
- ...

### Rare / Other  
- ...

---

## 2️⃣ 🧪 INVESTIGATIONS

### Bedside  
- ...

### Laboratory  
- ...

### Imaging  
- ...

---

## 3️⃣ 💊 EMERGENCY DEPARTMENT MANAGEMENT

### Time-Critical  
- ...

### Core ED Care  
- ...

### Adjuncts  
- ...

---

## 4️⃣ 🚑 DISPOSITION
- ...

---

## 5️⃣ 🛡️ SAFETY-NETTING & DISCHARGE ADVICE
- ...

---

## 📁 Referenced GitHub Modules Used
- ...

---

## 🌍 International Guideline References (general, not patient-specific)
- AU: RCH Clinical Guidelines / ACI NSW  
- NZ: Starship Clinical Guidelines  
- UK: NICE / RCEM  
- USA: ACEP / AAP  
- CAN: CAEP  

---

### 🔄 Optional Follow-Up  
At the very end of your answer, ALWAYS append exactly:

> Would you like:  
> 1) ACEM-style exam practice based on this case (MCQ / SAQ / Viva), or  
> 2) 1–2 key recent papers or guideline updates with brief PICO-style summaries?

DO NOT generate exam questions or research summaries until the user explicitly says yes.
`;

// -----------------------------
// MAIN HANDLER — STREAMING
// -----------------------------
export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST only" });

  try {
    const { message, model = "gpt-4.1-mini", engine = "default" } =
      req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required" });
    }

    // Load resources in parallel
    const [rawInstructions, engines, githubGuidelines] = await Promise.all([
      loadInstructions(),
      loadEngines(),
      searchGithubGuidelines(message, 3),
    ]);

    const contextBlock = buildContextBlock(engines, githubGuidelines);

    // SYSTEM MESSAGE 1 — core role + safety + "no weird spaces"
    const SYSTEM_MSG_1 = `
${rawInstructions}

Additional backend rules (OVERRIDE ANY CONFLICTING STYLE INSTRUCTIONS):

- ALWAYS output in clean Markdown using the separate MARKDOWN TEMPLATE message.
- NEVER insert spaces inside individual words (e.g. "Bre athing" is forbidden; use "Breathing").
- Do NOT break clinical terms apart with spaces.
- Maintain clear spacing between sections and headings.
- Use concise, high-yield language suitable for Emergency Medicine education.
`;

    // SYSTEM MESSAGE 2 — pure markdown template
    const SYSTEM_MSG_2 = MARKDOWN_TEMPLATE;

    // SYSTEM MESSAGE 3 — engines + GitHub modules
    const SYSTEM_MSG_3 = contextBlock;

    // Set streaming headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // @ts-ignore
    if (res.flushHeaders) res.flushHeaders();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await openai.chat.completions.create({
      model,
      stream: true,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are ED AI Tutor, an Emergency Medicine reasoning engine. ALWAYS follow the formatting rules and safety constraints from the following system messages.",
        },
        { role: "system", content: SYSTEM_MSG_1 },
        { role: "system", content: SYSTEM_MSG_2 },
        { role: "system", content: SYSTEM_MSG_3 },
        {
          role: "user",
          content: message,
        },
      ],
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
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
}

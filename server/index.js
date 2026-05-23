import express from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enrichModel, getSystemProfile, profileManuscript, scoreModels } from "./advisor.js";
import { extractManuscriptText } from "./extract.js";
import { getOllamaStatus, listOllamaModels, showOllamaModel } from "./ollama.js";
import { createReviewReport } from "./report.js";
import { manuscripts, reports } from "./storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const port = Number(process.env.PORT || 9091);
const apiOnly = process.env.API_ONLY === "1";
const server = http.createServer(app);

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true, ollama: await getOllamaStatus() });
});

app.get("/api/system", async (_req, res, next) => {
  try {
    res.json(await getSystemProfile());
  } catch (error) {
    next(error);
  }
});

app.get("/api/models", async (_req, res, next) => {
  try {
    const rawModels = await listOllamaModels();
    const enriched = [];
    for (const rawModel of rawModels) {
      const name = rawModel.name ?? rawModel.model;
      const showInfo = name ? await showOllamaModel(name) : {};
      enriched.push(enrichModel(rawModel, showInfo));
    }
    res.json({ models: enriched });
  } catch (error) {
    next(error);
  }
});

app.post("/api/manuscripts/inspect", upload.single("manuscript"), async (req, res, next) => {
  try {
    if (!req.file) throw new Error("Upload a manuscript file first.");

    const text = await extractManuscriptText(req.file);
    if (text.length < 200) throw new Error("The manuscript text looks too short to review.");

    const profile = profileManuscript(text, req.file.originalname);
    const systemProfile = await getSystemProfile();
    const rawModels = await listOllamaModels();
    const models = [];

    for (const rawModel of rawModels) {
      const name = rawModel.name ?? rawModel.model;
      const showInfo = name ? await showOllamaModel(name) : {};
      models.push(enrichModel(rawModel, showInfo));
    }

    const recommendations = scoreModels(models, systemProfile, profile);
    const id = randomUUID();
    manuscripts.set(id, { id, text, profile, createdAt: new Date().toISOString() });

    res.json({ manuscriptId: id, profile, systemProfile, models: recommendations });
  } catch (error) {
    next(error);
  }
});

app.post("/api/reports", async (req, res, next) => {
  try {
    const { manuscriptId, model } = req.body;
    const manuscript = manuscripts.get(manuscriptId);
    if (!manuscript) throw new Error("Manuscript expired or was not found. Upload it again.");
    if (!model) throw new Error("Select a model before generating the report.");

    const systemProfile = await getSystemProfile();
    const rawModels = await listOllamaModels();
    let selectedModel = null;
    for (const rawModel of rawModels) {
      const name = rawModel.name ?? rawModel.model;
      if (name === model) {
        selectedModel = enrichModel(rawModel, await showOllamaModel(name));
        break;
      }
    }

    if (!selectedModel) throw new Error("The selected Ollama model is not installed.");
    const [modelScore] = scoreModels([selectedModel], systemProfile, manuscript.profile);
    const report = await createReviewReport({ manuscript, model, modelScore, systemProfile });
    reports.set(report.id, report);

    res.json({
      reportId: report.id,
      html: report.html,
      markdown: report.markdown,
      metadata: report.metadata,
      docxUrl: `/api/reports/${report.id}/docx`,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/reports/:id/docx", (req, res, next) => {
  const report = reports.get(req.params.id);
  if (!report) {
    next(new Error("Report not found."));
    return;
  }
  res.download(report.docxPath, `manuscript-review-${req.params.id}.docx`);
});

app.use((error, _req, res, _next) => {
  res.status(400).json({ error: error.message || "Request failed." });
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("*", (_req, res) => res.sendFile(path.join(root, "dist/index.html")));
} else if (!apiOnly) {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root,
    server: {
      host: "127.0.0.1",
      middlewareMode: true,
      hmr: { server },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the existing process or set PORT to another value.`);
    process.exit(1);
  }
  throw error;
});

server.listen(port, "127.0.0.1", () => {
  const mode = apiOnly ? "API" : "app";
  console.log(`ManuReview ${mode} running at http://localhost:${port}`);
});

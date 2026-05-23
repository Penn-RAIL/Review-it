import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FAMILY_CONTEXT_DEFAULTS = [
  [/llama\s*3\.1|llama3\.1/i, 128000],
  [/llama\s*3\.2|llama3\.2/i, 128000],
  [/qwen\s*2\.5|qwen2\.5/i, 32768],
  [/mistral|mixtral/i, 32768],
  [/gemma/i, 8192],
  [/phi/i, 128000],
];

export async function getSystemProfile() {
  const totalRamGb = bytesToGb(os.totalmem());
  const platform = os.platform();
  const gpu = await detectGpu(platform);

  return {
    platform,
    arch: os.arch(),
    cpu: os.cpus()?.[0]?.model ?? "Unknown CPU",
    cpuCores: os.cpus()?.length ?? null,
    totalRamGb,
    usableRamGb: round(totalRamGb * (platform === "darwin" ? 0.72 : 0.65), 1),
    gpu,
    memoryMode: platform === "darwin" ? "unified" : gpu.vramGb ? "gpu" : "system",
  };
}

export function profileManuscript(text, fileName) {
  const clean = text.replace(/\s+/g, " ").trim();
  const words = clean ? clean.split(/\s+/).length : 0;
  const estimatedTokens = Math.ceil(words * 1.32);
  const sections = estimateSections(text);

  return {
    fileName,
    characters: text.length,
    words,
    estimatedTokens,
    sections,
    manuscriptSize: sizeLabel(estimatedTokens),
  };
}

export function enrichModel(rawModel, showInfo = {}) {
  const name = rawModel.name ?? rawModel.model ?? "unknown";
  const details = showInfo.details ?? rawModel.details ?? {};
  const modelInfo = showInfo.model_info ?? {};
  const parameterCount =
    parseParameterCount(details.parameter_size) ??
    parseNumericParameterCount(modelInfo["general.parameter_count"]) ??
    parseParamsFromName(name);
  const quantization =
    details.quantization_level ??
    modelInfo["general.quantization_version"] ??
    parseQuantFromName(name) ??
    "Q4";
  const estimatedMemoryGb = estimateMemoryGb(parameterCount, quantization);
  const contextWindow =
    Number(modelInfo["llama.context_length"]) ||
    Number(modelInfo["qwen2.context_length"]) ||
    Number(modelInfo["gemma3.context_length"]) ||
    parseContextFromParameters(showInfo.parameters) ||
    inferContextWindow(name);

  return {
    name,
    modifiedAt: rawModel.modified_at,
    sizeGb: rawModel.size ? round(rawModel.size / 1024 ** 3, 1) : null,
    parameterCountB: parameterCount,
    parameterLabel: parameterCount ? `${trimDecimal(parameterCount)}B` : "Unknown",
    quantization,
    estimatedMemoryGb,
    contextWindow,
    family: details.family ?? modelInfo["general.architecture"] ?? inferFamily(name),
  };
}

export function scoreModels(models, systemProfile, manuscriptProfile) {
  return models
    .map((model) => scoreModel(model, systemProfile, manuscriptProfile))
    .sort((a, b) => b.score - a.score);
}

function scoreModel(model, systemProfile, manuscriptProfile) {
  const memoryPoolGb = systemProfile.gpu.vramGb || systemProfile.usableRamGb;
  const memoryRatio = model.estimatedMemoryGb ? model.estimatedMemoryGb / memoryPoolGb : 0.9;
  const promptReserve = 1800;
  const reviewBudget = Math.max(1024, model.contextWindow - promptReserve);
  const manuscriptRatio = manuscriptProfile.estimatedTokens / reviewBudget;

  const hardwareFit =
    memoryRatio <= 0.6 ? 100 : memoryRatio <= 0.85 ? 74 : memoryRatio <= 1 ? 48 : memoryRatio <= 1.35 ? 25 : 0;
  const contextFit =
    manuscriptRatio <= 0.8 ? 100 : manuscriptRatio <= 3 ? 76 : manuscriptRatio <= 9 ? 48 : 22;
  const quality = model.parameterCountB ? Math.min(100, 32 + Math.log2(model.parameterCountB + 1) * 18) : 52;
  const speed = model.parameterCountB ? Math.max(20, 100 - model.parameterCountB * 2.2 - memoryRatio * 12) : 50;
  const score = Math.round(hardwareFit * 0.38 + contextFit * 0.25 + quality * 0.22 + speed * 0.15);

  const fit = fitLabel(memoryRatio);
  const handling = handlingLabel(manuscriptRatio);
  const speedLabel = speed >= 76 ? "Fast" : speed >= 50 ? "Moderate" : "Slow";
  const recommendation = recommendationLabel(score, fit, handling);

  return {
    ...model,
    score,
    fit,
    speed: speedLabel,
    manuscriptHandling: handling,
    recommendation,
    reasons: buildReasons(model, fit, handling, memoryPoolGb, manuscriptProfile.estimatedTokens),
  };
}

function buildReasons(model, fit, handling, memoryPoolGb, tokens) {
  const reasons = [];
  if (model.estimatedMemoryGb) {
    reasons.push(`${model.estimatedMemoryGb} GB estimated model memory against ${round(memoryPoolGb, 1)} GB available pool`);
  }
  reasons.push(`${tokens.toLocaleString()} estimated manuscript tokens vs ${model.contextWindow.toLocaleString()} context`);
  reasons.push(`${fit} hardware fit and ${handling.toLowerCase()} manuscript handling`);
  return reasons;
}

function fitLabel(memoryRatio) {
  if (memoryRatio <= 0.6) return "Comfortable";
  if (memoryRatio <= 0.85) return "Usable";
  if (memoryRatio <= 1) return "Tight";
  if (memoryRatio <= 1.35) return "Slow fallback";
  return "Not recommended";
}

function handlingLabel(manuscriptRatio) {
  if (manuscriptRatio <= 0.8) return "Direct review";
  if (manuscriptRatio <= 3) return "Light chunking";
  if (manuscriptRatio <= 9) return "Multi-pass chunking";
  return "Heavy chunking";
}

function recommendationLabel(score, fit, handling) {
  if (fit === "Not recommended") return "Avoid on this machine";
  if (score >= 82) return "Best overall";
  if (score >= 68) return handling === "Direct review" ? "Strong choice" : "Recommended with chunking";
  if (score >= 50) return "Usable, expect tradeoffs";
  return "Only use if needed";
}

function estimateMemoryGb(parameterCountB, quantization) {
  if (!parameterCountB) return null;
  const quant = String(quantization).toUpperCase();
  const bits = quant.includes("Q8") ? 8 : quant.includes("Q6") ? 6 : quant.includes("Q5") ? 5 : quant.includes("Q3") ? 3.5 : 4.5;
  return round(parameterCountB * (bits / 8) * 1.22 + 0.8, 1);
}

function parseParameterCount(value) {
  if (!value) return null;
  const match = String(value).match(/([\d.]+)\s*B/i);
  return match ? Number(match[1]) : null;
}

function parseNumericParameterCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? round(n / 1e9, 1) : null;
}

function parseParamsFromName(name) {
  const match = String(name).match(/(?:^|[-_:])(\d+(?:\.\d+)?)\s*b(?:[-_:]|$)/i);
  return match ? Number(match[1]) : null;
}

function parseQuantFromName(name) {
  const match = String(name).match(/q[2-8](?:_[a-z])?/i);
  return match ? match[0].toUpperCase() : null;
}

function parseContextFromParameters(parameters = "") {
  const match = String(parameters).match(/num_ctx\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function inferContextWindow(name) {
  for (const [pattern, context] of FAMILY_CONTEXT_DEFAULTS) {
    if (pattern.test(name)) return context;
  }
  return 8192;
}

function inferFamily(name) {
  return String(name).split(/[/:_-]/)[0] || "unknown";
}

function estimateSections(text) {
  const matches = text.match(/(?:^|\n)\s*(abstract|introduction|methods?|results?|discussion|conclusion|references)\s*(?:\n|$)/gi);
  return matches ? [...new Set(matches.map((m) => m.trim().toLowerCase()))].length : null;
}

function sizeLabel(tokens) {
  if (tokens < 7000) return "Short";
  if (tokens < 18000) return "Typical article";
  if (tokens < 45000) return "Long article";
  return "Very long manuscript";
}

async function detectGpu(platform) {
  if (platform === "darwin") {
    return detectMacGpu();
  }

  const nvidia = await tryExec("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  if (nvidia) {
    const [name, memory] = nvidia.split("\n")[0].split(",").map((part) => part.trim());
    return { name, vramGb: memory ? round(Number(memory) / 1024, 1) : null, source: "nvidia-smi" };
  }

  return { name: "No discrete GPU detected", vramGb: null, source: "system" };
}

async function detectMacGpu() {
  const output = await tryExec("system_profiler", ["SPDisplaysDataType"]);
  if (!output) {
    return { name: "Apple unified memory", vramGb: null, source: "system" };
  }

  const chip = output.match(/Chipset Model:\s*(.+)/)?.[1]?.trim();
  const vram = output.match(/VRAM.*:\s*(\d+)\s*GB/i)?.[1];
  return {
    name: chip || "Apple unified memory",
    vramGb: vram ? Number(vram) : null,
    source: "system_profiler",
  };
}

async function tryExec(command, args) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 2500 });
    return stdout.trim();
  } catch {
    return "";
  }
}

function bytesToGb(bytes) {
  return round(bytes / 1024 ** 3, 1);
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function trimDecimal(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0$/, "");
}

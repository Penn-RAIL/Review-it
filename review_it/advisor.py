import math
import os
import platform
import re
import subprocess

import psutil


FAMILY_CONTEXT_DEFAULTS = [
    (re.compile(r"llama\s*3\.1|llama3\.1", re.I), 128000),
    (re.compile(r"llama\s*3\.2|llama3\.2", re.I), 128000),
    (re.compile(r"qwen\s*2\.5|qwen2\.5", re.I), 32768),
    (re.compile(r"mistral|mixtral", re.I), 32768),
    (re.compile(r"gemma", re.I), 8192),
    (re.compile(r"phi", re.I), 128000),
]


def get_system_profile() -> dict:
    total_ram_gb = round(psutil.virtual_memory().total / 1024**3, 1)
    system = platform.system().lower()
    gpu = detect_gpu(system)
    return {
        "platform": "darwin" if system == "darwin" else system,
        "arch": platform.machine(),
        "cpu": platform.processor() or platform.machine() or "Unknown CPU",
        "cpuCores": os.cpu_count(),
        "totalRamGb": total_ram_gb,
        "usableRamGb": round(total_ram_gb * (0.72 if system == "darwin" else 0.65), 1),
        "gpu": gpu,
        "memoryMode": "unified" if system == "darwin" else ("gpu" if gpu.get("vramGb") else "system"),
    }


def profile_manuscript(text: str, filename: str) -> dict:
    clean = re.sub(r"\s+", " ", text).strip()
    words = len(clean.split()) if clean else 0
    estimated_tokens = math.ceil(words * 1.32)
    return {
        "fileName": filename,
        "characters": len(text),
        "words": words,
        "estimatedTokens": estimated_tokens,
        "sections": estimate_sections(text),
        "manuscriptSize": size_label(estimated_tokens),
    }


def enrich_model(raw_model: dict, show_info: dict | None = None) -> dict:
    show_info = show_info or {}
    name = raw_model.get("name") or raw_model.get("model") or "unknown"
    details = show_info.get("details") or raw_model.get("details") or {}
    model_info = show_info.get("model_info") or {}
    parameter_count = (
        parse_parameter_count(details.get("parameter_size"))
        or parse_numeric_parameter_count(model_info.get("general.parameter_count"))
        or parse_params_from_name(name)
    )
    quantization = (
        details.get("quantization_level")
        or model_info.get("general.quantization_version")
        or parse_quant_from_name(name)
        or "Q4"
    )
    context_window = (
        as_int(model_info.get("llama.context_length"))
        or as_int(model_info.get("qwen2.context_length"))
        or as_int(model_info.get("gemma3.context_length"))
        or parse_context_from_parameters(show_info.get("parameters", ""))
        or infer_context_window(name)
    )
    return {
        "name": name,
        "modifiedAt": raw_model.get("modified_at"),
        "sizeGb": round(raw_model["size"] / 1024**3, 1) if raw_model.get("size") else None,
        "parameterCountB": parameter_count,
        "parameterLabel": f"{trim_decimal(parameter_count)}B" if parameter_count else "Unknown",
        "quantization": quantization,
        "estimatedMemoryGb": estimate_memory_gb(parameter_count, quantization),
        "contextWindow": context_window,
        "family": details.get("family") or model_info.get("general.architecture") or infer_family(name),
    }


def score_models(models: list[dict], system_profile: dict, manuscript_profile: dict) -> list[dict]:
    return sorted(
        (score_model(model, system_profile, manuscript_profile) for model in models),
        key=lambda item: item["score"],
        reverse=True,
    )


def score_model(model: dict, system_profile: dict, manuscript_profile: dict) -> dict:
    memory_pool_gb = system_profile.get("gpu", {}).get("vramGb") or system_profile["usableRamGb"]
    memory_ratio = (model.get("estimatedMemoryGb") or (memory_pool_gb * 0.9)) / memory_pool_gb
    review_budget = max(1024, model["contextWindow"] - 1800)
    manuscript_ratio = manuscript_profile["estimatedTokens"] / review_budget

    hardware_fit = 100 if memory_ratio <= 0.6 else 74 if memory_ratio <= 0.85 else 48 if memory_ratio <= 1 else 25 if memory_ratio <= 1.35 else 0
    context_fit = 100 if manuscript_ratio <= 0.8 else 76 if manuscript_ratio <= 3 else 48 if manuscript_ratio <= 9 else 22
    quality = min(100, 32 + math.log2(model["parameterCountB"] + 1) * 18) if model.get("parameterCountB") else 52
    speed_value = max(20, 100 - model["parameterCountB"] * 2.2 - memory_ratio * 12) if model.get("parameterCountB") else 50
    score = round(hardware_fit * 0.38 + context_fit * 0.25 + quality * 0.22 + speed_value * 0.15)

    fit = fit_label(memory_ratio)
    handling = handling_label(manuscript_ratio)
    speed = "Fast" if speed_value >= 76 else "Moderate" if speed_value >= 50 else "Slow"

    scored = dict(model)
    scored.update(
        {
            "score": score,
            "fit": fit,
            "speed": speed,
            "manuscriptHandling": handling,
            "recommendation": recommendation_label(score, fit, handling),
            "reasons": build_reasons(model, fit, handling, memory_pool_gb, manuscript_profile["estimatedTokens"]),
        }
    )
    return scored


def build_reasons(model: dict, fit: str, handling: str, memory_pool_gb: float, tokens: int) -> list[str]:
    reasons = []
    if model.get("estimatedMemoryGb"):
        reasons.append(f"{model['estimatedMemoryGb']} GB estimated model memory against {round(memory_pool_gb, 1)} GB available pool")
    reasons.append(f"{tokens:,} estimated manuscript tokens vs {model['contextWindow']:,} context")
    reasons.append(f"{fit} hardware fit and {handling.lower()} manuscript handling")
    return reasons


def fit_label(memory_ratio: float) -> str:
    if memory_ratio <= 0.6:
        return "Comfortable"
    if memory_ratio <= 0.85:
        return "Usable"
    if memory_ratio <= 1:
        return "Tight"
    if memory_ratio <= 1.35:
        return "Slow fallback"
    return "Not recommended"


def handling_label(manuscript_ratio: float) -> str:
    if manuscript_ratio <= 0.8:
        return "Direct review"
    if manuscript_ratio <= 3:
        return "Light chunking"
    if manuscript_ratio <= 9:
        return "Multi-pass chunking"
    return "Heavy chunking"


def recommendation_label(score: int, fit: str, handling: str) -> str:
    if fit == "Not recommended":
        return "Avoid on this machine"
    if score >= 82:
        return "Best overall"
    if score >= 68:
        return "Strong choice" if handling == "Direct review" else "Recommended with chunking"
    if score >= 50:
        return "Usable, expect tradeoffs"
    return "Only use if needed"


def estimate_memory_gb(parameter_count_b: float | None, quantization: str) -> float | None:
    if not parameter_count_b:
        return None
    quant = str(quantization).upper()
    bits = 8 if "Q8" in quant else 6 if "Q6" in quant else 5 if "Q5" in quant else 3.5 if "Q3" in quant else 4.5
    return round(parameter_count_b * (bits / 8) * 1.22 + 0.8, 1)


def parse_parameter_count(value) -> float | None:
    if not value:
        return None
    match = re.search(r"([\d.]+)\s*B", str(value), re.I)
    return float(match.group(1)) if match else None


def parse_numeric_parameter_count(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number / 1e9, 1) if number > 0 else None


def parse_params_from_name(name: str) -> float | None:
    match = re.search(r"(?:^|[-_:])(\d+(?:\.\d+)?)\s*b(?:[-_:]|$)", name, re.I)
    return float(match.group(1)) if match else None


def parse_quant_from_name(name: str) -> str | None:
    match = re.search(r"q[2-8](?:_[a-z])?", name, re.I)
    return match.group(0).upper() if match else None


def parse_context_from_parameters(parameters: str) -> int | None:
    match = re.search(r"num_ctx\s+(\d+)", parameters or "", re.I)
    return int(match.group(1)) if match else None


def infer_context_window(name: str) -> int:
    for pattern, context in FAMILY_CONTEXT_DEFAULTS:
        if pattern.search(name):
            return context
    return 8192


def infer_family(name: str) -> str:
    return re.split(r"[/:_-]", name)[0] or "unknown"


def estimate_sections(text: str) -> int | None:
    matches = re.findall(r"(?:^|\n)\s*(abstract|introduction|methods?|results?|discussion|conclusion|references)\s*(?:\n|$)", text, re.I)
    return len({match.strip().lower() for match in matches}) or None


def size_label(tokens: int) -> str:
    if tokens < 7000:
        return "Short"
    if tokens < 18000:
        return "Typical article"
    if tokens < 45000:
        return "Long article"
    return "Very long manuscript"


def detect_gpu(system: str) -> dict:
    if system == "darwin":
        return detect_mac_gpu()

    nvidia = try_exec(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
    if nvidia:
        name, _, memory = nvidia.splitlines()[0].partition(",")
        return {"name": name.strip(), "vramGb": round(float(memory.strip()) / 1024, 1) if memory.strip() else None, "source": "nvidia-smi"}

    return {"name": "No discrete GPU detected", "vramGb": None, "source": "system"}


def detect_mac_gpu() -> dict:
    output = try_exec(["system_profiler", "SPDisplaysDataType"])
    if not output:
        return {"name": "Apple unified memory", "vramGb": None, "source": "system"}
    chip = re.search(r"Chipset Model:\s*(.+)", output)
    vram = re.search(r"VRAM.*:\s*(\d+)\s*GB", output, re.I)
    return {
        "name": chip.group(1).strip() if chip else "Apple unified memory",
        "vramGb": int(vram.group(1)) if vram else None,
        "source": "system_profiler",
    }


def try_exec(command: list[str]) -> str:
    try:
        return subprocess.run(command, check=False, capture_output=True, text=True, timeout=2.5).stdout.strip()
    except Exception:
        return ""


def as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def trim_decimal(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(value).rstrip("0").rstrip(".")

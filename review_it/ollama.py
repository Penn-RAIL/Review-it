import os

import httpx


def get_ollama_url() -> str:
    return os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")


async def get_ollama_status() -> dict:
    url = get_ollama_url()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{url}/api/tags")
        return {"reachable": response.is_success, "url": url}
    except Exception:
        return {"reachable": False, "url": url}


async def list_ollama_models() -> list[dict]:
    url = get_ollama_url()
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(f"{url}/api/tags")
    if not response.is_success:
        raise RuntimeError(f"Ollama returned {response.status_code} while listing models.")
    return response.json().get("models", [])


async def show_ollama_model(name: str) -> dict:
    url = get_ollama_url()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(f"{url}/api/show", json={"model": name})
        if not response.is_success:
            return {}
        return response.json()
    except Exception:
        return {}


async def generate_with_ollama(model: str, prompt: str, options: dict | None = None) -> str:
    url = get_ollama_url()
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.2,
            "num_ctx": (options or {}).get("num_ctx"),
        },
    }
    async with httpx.AsyncClient(timeout=None) as client:
        response = await client.post(f"{url}/api/generate", json=payload)
    if not response.is_success:
        raise RuntimeError(f"Ollama generation failed: {response.status_code} {response.text}")
    return response.json().get("response", "")

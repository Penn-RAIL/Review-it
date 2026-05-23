const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

export async function getOllamaStatus() {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    return { reachable: response.ok, url: OLLAMA_URL };
  } catch {
    return { reachable: false, url: OLLAMA_URL };
  }
}

export async function listOllamaModels() {
  const response = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status} while listing models.`);
  }
  const data = await response.json();
  return data.models ?? [];
}

export async function showOllamaModel(name) {
  const response = await fetch(`${OLLAMA_URL}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name }),
  });

  if (!response.ok) {
    return {};
  }

  return response.json();
}

export async function generateWithOllama({ model, prompt, options = {} }) {
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_ctx: options.num_ctx,
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Ollama generation failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.response ?? "";
}

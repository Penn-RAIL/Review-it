# Review It

Local manuscript review tool powered by Ollama.

## What it does

- Upload a PDF, DOCX, TXT, Markdown, or RTF manuscript.
- Detect local machine memory and basic GPU/system profile.
- Query installed Ollama models.
- Score available models against hardware fit and manuscript size.
- Run a fixed pre-submission peer-review prompt on the manuscript.
- Generate a DOCX report and render it in the app for download.

## Requirements

- Node.js 20+
- Ollama running locally at `http://localhost:11434`
- At least one pulled Ollama model, for example:

```bash
ollama pull llama3.1:8b
```

## Run

### Pip package mode

Build the frontend once, then install the Python package locally:

```bash
npm install
npm run build
python -m pip install -e .
review-it
```

Open `http://localhost:9091` if the browser does not open automatically.

The `review-it` command serves the bundled React UI and backend API from one local port. It warns at startup if Ollama is not installed, not serving, or not reachable.

Generated report files are written to `~/.review-it/reports/`.

Useful options:

```bash
review-it --port 9092
review-it --no-browser
review-it --ollama-url http://localhost:11434
```

### Node development mode

```bash
npm install
npm run dev
```

Open `http://localhost:9091`.

In development, the frontend and backend run together on one port:

- App and API: `http://localhost:9091`

If Ollama is running somewhere else, set:

```bash
OLLAMA_URL=http://localhost:11434 npm run dev
```

The Node development backend writes generated report files to `generated/`.

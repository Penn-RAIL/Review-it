# review-it

![review-it logo](src/assets/logo.png)

Local manuscript review tool powered by Ollama.

## What it does

- Upload a PDF, DOCX, TXT, Markdown, or RTF manuscript.
- Detect local machine memory and basic GPU/system profile.
- Run a fixed pre-submission peer-review prompt on the manuscript.
- Generate a DOCX report and render it in the app for download.
- Recommend installed Ollama models based on detected memory and manuscript size.

## Requirements

- Python 3.10+
- Node.js 20+ for building the frontend during development or before publishing
- Ollama running locally at `http://localhost:11434`
- At least one pulled Ollama model, for example:

```bash
ollama pull llama3.1:8b
```

## Run

### Local Python package mode

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

### Development mode

```bash
npm install
python3 -m pip install -e .
npm run dev
```

Open `http://localhost:9091`.

In development, `npm run dev` rebuilds the React frontend and launches the Python/FastAPI backend. The frontend and API are served together on one port:

- App and API: `http://localhost:9091`

If Ollama is running somewhere else, set:

```bash
OLLAMA_URL=http://localhost:11434 npm run dev
```

Generated report files are written to `~/.review-it/reports/`.

## Quick install from PyPI

Install and run in one minute:

```bash
python -m pip install --upgrade review-it
review-it
```

If you prefer isolated app installs, use `pipx`:

```bash
pipx install review-it
review-it
```

## Publishing To PyPI

Before publishing, confirm the package name `review-it` is available or already owned by the project maintainers on PyPI and TestPyPI.

1. Create accounts on PyPI and TestPyPI.
2. Create API tokens for both accounts.
3. Build the frontend assets that get bundled into the Python package:

```bash
npm install
npm run build
```

4. Build the Python source distribution and wheel:

```bash
python -m pip install build twine
python -m build
```

5. Upload to TestPyPI first:

```bash
python -m twine upload --repository testpypi dist/*
```

6. Test the TestPyPI install in a clean virtual environment:

```bash
python -m venv /tmp/review-it-test
source /tmp/review-it-test/bin/activate
pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple review-it
review-it
```

7. If the TestPyPI install works, upload to PyPI:

```bash
python -m twine upload dist/*
```

After the PyPI upload, users can install and run:

```bash
pip install review-it
review-it
# or
python -m review_it
```

For each new release, update `version` in `pyproject.toml`, rebuild the frontend, rebuild the package, and upload the new artifacts. PyPI does not allow replacing an existing version.

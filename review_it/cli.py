import argparse
import os
import threading
import time
import webbrowser

import httpx
import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Review It local manuscript review app.")
    parser.add_argument("--host", default="127.0.0.1", help="Host interface to bind.")
    parser.add_argument("--port", default=9091, type=int, help="Port to serve the app on.")
    parser.add_argument("--ollama-url", default=os.environ.get("OLLAMA_URL", "http://localhost:11434"), help="Ollama base URL.")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser automatically.")
    args = parser.parse_args()

    os.environ["OLLAMA_URL"] = args.ollama_url.rstrip("/")
    url = f"http://{args.host}:{args.port}"

    if not ollama_is_reachable(os.environ["OLLAMA_URL"]):
        print(
            f"Warning: Ollama is not reachable at {os.environ['OLLAMA_URL']}. "
            "The app will open, but model discovery and report generation need Ollama running.",
            flush=True,
        )

    print(f"Review It running at {url}", flush=True)
    if not args.no_browser:
        threading.Thread(target=open_browser_later, args=(url,), daemon=True).start()

    uvicorn.run("review_it.server:app", host=args.host, port=args.port, log_level="info")


def ollama_is_reachable(ollama_url: str) -> bool:
    try:
        response = httpx.get(f"{ollama_url.rstrip('/')}/api/tags", timeout=2.0)
        return response.is_success
    except Exception:
        return False


def open_browser_later(url: str) -> None:
    time.sleep(0.8)
    webbrowser.open(url)


if __name__ == "__main__":
    main()

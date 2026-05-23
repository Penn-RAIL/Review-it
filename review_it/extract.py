import re
from io import BytesIO
from pathlib import Path

from docx import Document
from pypdf import PdfReader


TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".rtf"}


def extract_manuscript_text(filename: str, content: bytes) -> str:
    ext = Path(filename).suffix.lower()

    if ext == ".docx":
        document = Document(BytesIO(content))
        text = "\n".join(paragraph.text for paragraph in document.paragraphs)
        return normalize_text(text)

    if ext == ".pdf":
        reader = PdfReader(BytesIO(content))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        return normalize_text(text)

    if ext in TEXT_EXTENSIONS:
        return normalize_text(content.decode("utf-8", errors="replace"))

    raise ValueError("Unsupported file type. Upload a PDF, DOCX, TXT, or Markdown manuscript.")


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()

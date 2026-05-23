import html
import re
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt

from .ollama import generate_with_ollama
from .review_prompt import build_review_prompt


REPORT_DIR = Path.home() / ".review-it" / "reports"


async def create_review_report(manuscript: dict, model: str, model_score: dict, system_profile: dict) -> dict:
    started_at = datetime.now()
    prompt = build_review_prompt(manuscript["text"])
    markdown = await generate_with_ollama(
        model=model,
        prompt=prompt,
        options={"num_ctx": min(model_score.get("contextWindow", 8192), 131072)},
    )
    markdown = normalize_markdown(markdown)

    report = {
        "id": str(uuid4()),
        "model": model,
        "createdAt": started_at.isoformat(),
        "markdown": markdown,
        "html": markdown_to_html(markdown),
        "metadata": {
            "manuscript": manuscript["profile"],
            "modelScore": model_score,
            "systemProfile": system_profile,
            "promptMode": "fixed pre-submission peer review prompt",
        },
    }
    report["docxPath"] = str(write_docx(report))
    return report


def write_docx(report: dict) -> Path:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    file_path = REPORT_DIR / f"{report['id']}.docx"

    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.75)
    section.bottom_margin = Inches(0.75)
    section.left_margin = Inches(0.75)
    section.right_margin = Inches(0.75)

    styles = document.styles
    styles["Normal"].font.name = "Aptos"
    styles["Normal"].font.size = Pt(11)

    title = document.add_heading("Manuscript Review Report", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    subtitle = document.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    subtitle.add_run(report["metadata"]["manuscript"]["fileName"]).bold = True
    subtitle.add_run(f" | {datetime.fromisoformat(report['createdAt']).strftime('%Y-%m-%d %H:%M')}")

    document.add_heading("Review Metadata", level=1)
    add_metadata_table(document, report)
    add_markdown(document, report["markdown"])
    document.save(file_path)
    return file_path


def add_metadata_table(document: Document, report: dict) -> None:
    rows = [
        ("Model", report["model"]),
        ("Model recommendation", report["metadata"]["modelScore"].get("recommendation", "Unknown")),
        ("Hardware fit", report["metadata"]["modelScore"].get("fit", "Unknown")),
        ("Manuscript words", str(report["metadata"]["manuscript"]["words"])),
        ("Estimated tokens", str(report["metadata"]["manuscript"]["estimatedTokens"])),
        ("Prompt mode", report["metadata"]["promptMode"]),
    ]
    table = document.add_table(rows=0, cols=2)
    table.style = "Table Grid"
    for label, value in rows:
        cells = table.add_row().cells
        cells[0].text = label
        cells[0].paragraphs[0].runs[0].bold = True
        cells[1].text = str(value)


def add_markdown(document: Document, markdown: str) -> None:
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            document.add_paragraph("")
            continue
        if line.startswith("# "):
            document.add_heading(line[2:].strip(), level=1)
            continue
        if line.startswith("## "):
            document.add_heading(line[3:].strip(), level=2)
            continue
        if line.startswith("### "):
            document.add_heading(line[4:].strip(), level=3)
            continue
        if re.match(r"^[-*]\s+", line):
            document.add_paragraph(re.sub(r"^[-*]\s+", "", line), style="List Bullet")
            continue
        document.add_paragraph(line)


def markdown_to_html(markdown: str) -> str:
    output = []
    in_list = False
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            if in_list:
                output.append("</ul>")
                in_list = False
            continue
        escaped = html.escape(line)
        if escaped.startswith("# "):
            if in_list:
                output.append("</ul>")
                in_list = False
            output.append(f"<h1>{escaped[2:]}</h1>")
        elif escaped.startswith("## "):
            if in_list:
                output.append("</ul>")
                in_list = False
            output.append(f"<h2>{escaped[3:]}</h2>")
        elif escaped.startswith("### "):
            if in_list:
                output.append("</ul>")
                in_list = False
            output.append(f"<h3>{escaped[4:]}</h3>")
        elif re.match(r"^[-*]\s+", escaped):
            if not in_list:
                output.append("<ul>")
                in_list = True
            output.append(f"<li>{re.sub(r'^[-*]\\s+', '', escaped)}</li>")
        else:
            if in_list:
                output.append("</ul>")
                in_list = False
            output.append(f"<p>{escaped}</p>")
    if in_list:
        output.append("</ul>")
    return "".join(output)


def normalize_markdown(markdown: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", markdown.strip())

import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".rtf"]);

export async function extractManuscriptText(file) {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return normalizeText(result.value);
  }

  if (ext === ".pdf") {
    const result = await pdfParse(file.buffer);
    return normalizeText(result.text);
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    return normalizeText(file.buffer.toString("utf8"));
  }

  throw new Error("Unsupported file type. Upload a PDF, DOCX, TXT, or Markdown manuscript.");
}

function normalizeText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

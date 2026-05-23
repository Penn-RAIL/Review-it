import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { generateWithOllama } from "./ollama.js";
import { buildReviewPrompt } from "./reviewPrompt.js";

const GENERATED_DIR = path.resolve("generated");

export async function createReviewReport({ manuscript, model, modelScore, systemProfile }) {
  const startedAt = new Date();
  const prompt = buildReviewPrompt(manuscript.text);
  const markdown = await generateWithOllama({
    model,
    prompt,
    options: { num_ctx: Math.min(modelScore?.contextWindow ?? 8192, 131072) },
  });

  const report = {
    id: randomUUID(),
    model,
    createdAt: startedAt.toISOString(),
    markdown: normalizeMarkdown(markdown),
    html: markdownToHtml(normalizeMarkdown(markdown)),
    metadata: {
      manuscript: manuscript.profile,
      modelScore,
      systemProfile,
      promptMode: "fixed pre-submission peer review prompt",
    },
  };

  report.docxPath = await writeDocx(report);
  return report;
}

async function writeDocx(report) {
  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const filePath = path.join(GENERATED_DIR, `${report.id}.docx`);
  const doc = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "Normal",
          name: "Normal",
          run: { font: "Aptos", size: 22 },
          paragraph: { spacing: { line: 300, after: 120 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 900, right: 900, bottom: 900, left: 900 },
          },
        },
        children: buildDocxChildren(report),
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

function buildDocxChildren(report) {
  const children = [
    new Paragraph({
      text: "Manuscript Review Report",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: report.metadata.manuscript.fileName, bold: true }),
        new TextRun({ text: ` | ${new Date(report.createdAt).toLocaleString()}` }),
      ],
    }),
    new Paragraph({ text: "Review Metadata", heading: HeadingLevel.HEADING_1 }),
    metadataTable(report),
    ...markdownToDocx(report.markdown),
  ];

  return children;
}

function metadataTable(report) {
  const rows = [
    ["Model", report.model],
    ["Model recommendation", report.metadata.modelScore?.recommendation ?? "Unknown"],
    ["Hardware fit", report.metadata.modelScore?.fit ?? "Unknown"],
    ["Manuscript words", String(report.metadata.manuscript.words)],
    ["Estimated tokens", String(report.metadata.manuscript.estimatedTokens)],
    ["Prompt mode", report.metadata.promptMode],
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      ([label, value]) =>
        new TableRow({
          children: [
            new TableCell({
              width: { size: 32, type: WidthType.PERCENTAGE },
              children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
            }),
            new TableCell({
              width: { size: 68, type: WidthType.PERCENTAGE },
              children: [new Paragraph(String(value))],
            }),
          ],
        }),
    ),
  });
}

function markdownToDocx(markdown) {
  const lines = markdown.split("\n");
  const children = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      children.push(new Paragraph(""));
      continue;
    }

    if (line.startsWith("# ")) {
      children.push(new Paragraph({ text: line.replace(/^#\s+/, ""), heading: HeadingLevel.HEADING_1 }));
      continue;
    }

    if (line.startsWith("## ")) {
      children.push(new Paragraph({ text: line.replace(/^##\s+/, ""), heading: HeadingLevel.HEADING_2 }));
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      children.push(
        new Paragraph({
          text: line.replace(/^[-*]\s+/, ""),
          bullet: { level: 0 },
        }),
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      children.push(new Paragraph(line.replace(/^\d+\.\s+/, "")));
      continue;
    }

    children.push(new Paragraph(line));
  }

  return children;
}

function markdownToHtml(markdown) {
  const escaped = escapeHtml(markdown);
  const lines = escaped.split("\n");
  let html = "";
  let inList = false;

  for (const line of lines) {
    if (!line.trim()) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      continue;
    }

    if (line.startsWith("# ")) {
      if (inList) html += "</ul>";
      inList = false;
      html += `<h1>${line.slice(2)}</h1>`;
    } else if (line.startsWith("## ")) {
      if (inList) html += "</ul>";
      inList = false;
      html += `<h2>${line.slice(3)}</h2>`;
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${line.replace(/^[-*]\s+/, "")}</li>`;
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<p>${line}</p>`;
    }
  }

  if (inList) html += "</ul>";
  return html;
}

function normalizeMarkdown(markdown) {
  return markdown.trim().replace(/\n{3,}/g, "\n\n");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

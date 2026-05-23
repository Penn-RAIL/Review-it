import { useEffect, useMemo, useRef, useState } from "react";
import { renderAsync } from "docx-preview";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  Gauge,
  Loader2,
  MemoryStick,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";

const formatNumber = (value) => (Number.isFinite(value) ? value.toLocaleString() : "Unknown");

export default function App() {
  const [health, setHealth] = useState(null);
  const [file, setFile] = useState(null);
  const [inspection, setInspection] = useState(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [report, setReport] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const docxRef = useRef(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false, ollama: { reachable: false } }));
  }, []);

  useEffect(() => {
    if (!inspection?.models?.length || selectedModel) return;
    setSelectedModel(inspection.models[0].name);
  }, [inspection, selectedModel]);

  useEffect(() => {
    if (!report?.docxUrl || !docxRef.current) return;

    let cancelled = false;
    docxRef.current.innerHTML = "";

    fetch(report.docxUrl)
      .then((response) => response.blob())
      .then((blob) => {
        if (!cancelled && docxRef.current) {
          return renderAsync(blob, docxRef.current, null, {
            className: "docx-preview",
            inWrapper: false,
            ignoreWidth: false,
            ignoreHeight: false,
          });
        }
        return null;
      })
      .catch(() => {
        if (docxRef.current) {
          docxRef.current.innerHTML = report.html;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [report]);

  const selectedModelScore = useMemo(
    () => inspection?.models?.find((model) => model.name === selectedModel),
    [inspection, selectedModel],
  );

  async function inspectManuscript(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose a manuscript file first.");
      return;
    }

    setStatus("inspecting");
    setError("");
    setReport(null);
    setSelectedModel("");

    const formData = new FormData();
    formData.append("manuscript", file);

    try {
      const response = await fetch("/api/manuscripts/inspect", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.detail || "Could not inspect manuscript.");
      setInspection(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  async function generateReport() {
    if (!inspection?.manuscriptId || !selectedModel) return;

    setStatus("generating");
    setError("");
    setReport(null);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manuscriptId: inspection.manuscriptId,
          model: selectedModel,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.detail || "Could not generate report.");
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatus("idle");
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">MR</div>
          <div>
            <h1>ManuReview</h1>
            <p>Local manuscript review with Ollama</p>
          </div>
        </div>

        <StatusPill health={health} />

        <nav className="steps" aria-label="Workflow">
          <Step active={!inspection} done={Boolean(inspection)} label="Upload" />
          <Step active={Boolean(inspection && !report)} done={Boolean(report)} label="Select model" />
          <Step active={Boolean(report)} done={Boolean(report)} label="Report" />
        </nav>

        {inspection?.systemProfile && <SystemSummary system={inspection.systemProfile} />}
      </aside>

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">Local decision support</p>
            <h2>Review a manuscript and choose the model that fits the machine.</h2>
          </div>
          <button className="icon-button" onClick={() => window.location.reload()} title="Start over">
            <RefreshCw size={18} />
          </button>
        </header>

        {error && (
          <div className="notice error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <section className="upload-band">
          <form onSubmit={inspectManuscript} className="upload-form">
            <label className="file-drop">
              <Upload size={22} />
              <span>{file ? file.name : "Choose PDF, DOCX, TXT, or Markdown manuscript"}</span>
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,.rtf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button className="primary-button" disabled={status === "inspecting"}>
              {status === "inspecting" ? <Loader2 className="spin" size={18} /> : <Gauge size={18} />}
              Inspect and score models
            </button>
          </form>
        </section>

        {inspection && (
          <section className="decision-layout">
            <div className="manuscript-strip">
              <Metric icon={<FileText size={18} />} label="Words" value={formatNumber(inspection.profile.words)} />
              <Metric
                icon={<Sparkles size={18} />}
                label="Estimated tokens"
                value={formatNumber(inspection.profile.estimatedTokens)}
              />
              <Metric icon={<Cpu size={18} />} label="Size" value={inspection.profile.manuscriptSize} />
            </div>

            <div className="model-table-wrap">
              <div className="section-heading">
                <div>
                  <h3>Available Ollama Models</h3>
                  <p>Ranked against detected memory, estimated model footprint, and manuscript size.</p>
                </div>
                <button
                  className="primary-button compact"
                  onClick={generateReport}
                  disabled={!selectedModel || status === "generating"}
                >
                  {status === "generating" ? <Loader2 className="spin" size={18} /> : <FileText size={18} />}
                  Generate DOCX
                </button>
              </div>

              <div className="model-table" role="table">
                <div className="model-row header" role="row">
                  <span>Model</span>
                  <span>Score</span>
                  <span>Fit</span>
                  <span>Handling</span>
                  <span>Speed</span>
                  <span>Recommendation</span>
                </div>
                {inspection.models.map((model) => (
                  <button
                    className={`model-row ${selectedModel === model.name ? "selected" : ""}`}
                    key={model.name}
                    onClick={() => setSelectedModel(model.name)}
                    type="button"
                    role="row"
                  >
                    <span>
                      <strong>{model.name}</strong>
                      <small>
                        {model.parameterLabel} | {model.quantization} | {model.estimatedMemoryGb ?? "?"} GB
                      </small>
                    </span>
                    <span>{model.score}</span>
                    <span>{model.fit}</span>
                    <span>{model.manuscriptHandling}</span>
                    <span>{model.speed}</span>
                    <span>{model.recommendation}</span>
                  </button>
                ))}
              </div>
            </div>

            {selectedModelScore && (
              <div className="advisor-note">
                <CheckCircle2 size={18} />
                <div>
                  <strong>{selectedModelScore.name}</strong>
                  <p>{selectedModelScore.reasons.join(". ")}.</p>
                </div>
              </div>
            )}
          </section>
        )}

        {report && (
          <section className="report-section">
            <div className="section-heading">
              <div>
                <h3>DOCX Preview</h3>
                <p>Rendered from the generated Word document.</p>
              </div>
              <a className="download-button" href={report.docxUrl}>
                <Download size={18} />
                Download DOCX
              </a>
            </div>
            <div className="docx-surface" ref={docxRef} />
          </section>
        )}
      </section>
    </main>
  );
}

function StatusPill({ health }) {
  const reachable = health?.ollama?.reachable;
  return (
    <div className={`ollama-status ${reachable ? "ok" : "warn"}`}>
      {reachable ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
      <span>{reachable ? "Ollama connected" : "Ollama not connected"}</span>
    </div>
  );
}

function Step({ active, done, label }) {
  return (
    <div className={`step ${active ? "active" : ""} ${done ? "done" : ""}`}>
      <span />
      {label}
    </div>
  );
}

function SystemSummary({ system }) {
  return (
    <div className="system-summary">
      <h3>Detected Machine</h3>
      <div>
        <MemoryStick size={16} />
        <span>{system.totalRamGb} GB RAM</span>
      </div>
      <div>
        <Cpu size={16} />
        <span>{system.gpu?.name || system.cpu}</span>
      </div>
      <p>{system.memoryMode === "unified" ? "Using Mac unified memory estimates." : "Using detected GPU/system memory estimates."}</p>
    </div>
  );
}

function Metric({ icon, label, value }) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

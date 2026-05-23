from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .advisor import enrich_model, get_system_profile, profile_manuscript, score_models
from .extract import extract_manuscript_text
from .ollama import get_ollama_status, list_ollama_models, show_ollama_model
from .report import create_review_report
from .storage import manuscripts, reports


class ReportRequest(BaseModel):
    manuscriptId: str
    model: str


app = FastAPI(title="Review It")


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "ollama": await get_ollama_status()}


@app.get("/api/system")
async def system() -> dict:
    return get_system_profile()


@app.get("/api/models")
async def models() -> dict:
    raw_models = await list_ollama_models()
    enriched = []
    for raw_model in raw_models:
        name = raw_model.get("name") or raw_model.get("model")
        show_info = await show_ollama_model(name) if name else {}
        enriched.append(enrich_model(raw_model, show_info))
    return {"models": enriched}


@app.post("/api/manuscripts/inspect")
async def inspect_manuscript(manuscript: UploadFile = File(...)) -> dict:
    content = await manuscript.read()
    try:
        text = extract_manuscript_text(manuscript.filename or "manuscript", content)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    if len(text) < 200:
        raise HTTPException(status_code=400, detail="The manuscript text looks too short to review.")

    profile = profile_manuscript(text, manuscript.filename or "manuscript")
    system_profile = get_system_profile()
    raw_models = await list_ollama_models()
    enriched = []
    for raw_model in raw_models:
        name = raw_model.get("name") or raw_model.get("model")
        show_info = await show_ollama_model(name) if name else {}
        enriched.append(enrich_model(raw_model, show_info))

    recommendations = score_models(enriched, system_profile, profile)
    manuscript_id = str(uuid4())
    manuscripts[manuscript_id] = {"id": manuscript_id, "text": text, "profile": profile}
    return {
        "manuscriptId": manuscript_id,
        "profile": profile,
        "systemProfile": system_profile,
        "models": recommendations,
    }


@app.post("/api/reports")
async def create_report(request: ReportRequest) -> dict:
    manuscript = manuscripts.get(request.manuscriptId)
    if not manuscript:
        raise HTTPException(status_code=400, detail="Manuscript expired or was not found. Upload it again.")
    if not request.model:
        raise HTTPException(status_code=400, detail="Select a model before generating the report.")

    system_profile = get_system_profile()
    raw_models = await list_ollama_models()
    selected_model = None
    for raw_model in raw_models:
        name = raw_model.get("name") or raw_model.get("model")
        if name == request.model:
            selected_model = enrich_model(raw_model, await show_ollama_model(name))
            break

    if not selected_model:
        raise HTTPException(status_code=400, detail="The selected Ollama model is not installed.")

    model_score = score_models([selected_model], system_profile, manuscript["profile"])[0]
    report = await create_review_report(manuscript, request.model, model_score, system_profile)
    reports[report["id"]] = report
    return {
        "reportId": report["id"],
        "html": report["html"],
        "markdown": report["markdown"],
        "metadata": report["metadata"],
        "docxUrl": f"/api/reports/{report['id']}/docx",
    }


@app.get("/api/reports/{report_id}/docx")
async def download_docx(report_id: str):
    report = reports.get(report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    return FileResponse(
        report["docxPath"],
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"manuscript-review-{report_id}.docx",
    )


static_dir = Path(__file__).with_name("static")
index_file = static_dir / "index.html"

if index_file.exists():
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
else:
    @app.get("/{path:path}")
    async def missing_frontend(path: str = ""):
        return HTMLResponse(
            "<h1>Review It frontend is not built</h1>"
            "<p>Run <code>npm run build</code> before packaging or serving the app.</p>",
            status_code=503,
        )

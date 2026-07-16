from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import uuid
import zipfile
from xml.etree import ElementTree
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request
from werkzeug.utils import secure_filename


ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from packages.jobstore import (
    DEFAULT_DB_PATH,
    count_jobs as count_db_jobs,
    count_search_jobs,
    load_jobs as load_jobs_from_db,
    search_jobs as search_jobs_from_db,
    upsert_jobs,
)

RAW_DIR = ROOT_DIR / "data" / "raw"
PROCESSED_DIR = ROOT_DIR / "data" / "processed"
SNAPSHOT_DIR = ROOT_DIR / "data" / "snapshots"
PROFILE_DIR = ROOT_DIR / "data" / "profiles"
RESUME_DIR = PROFILE_DIR / "resumes"
RESUME_STORE = PROFILE_DIR / "resumes.json"
DEFAULT_PATTERN = "vagas*.csv"
DEFAULT_SNAPSHOT = SNAPSHOT_DIR / "jobs-snapshot.json"
JOB_CACHE: dict[str, tuple[tuple[int, int], list[dict[str, Any]]]] = {}
SNAPSHOT_CACHE: dict[str, tuple[tuple[int, int], dict[str, Any]]] = {}
SCRAPER_SOURCES = {
    "public", "remoteok", "arbeitnow", "remotive", "jobicy", "themuse",
    "adzuna", "linkedin", "indeed", "glassdoor", "gupy", "infojobs",
}
SCRAPE_LOCK = threading.Lock()
SCRAPE_STATE: dict[str, Any] = {
    "status": "idle",
    "message": "Nenhuma coleta manual iniciada nesta sessão.",
    "sources": [],
    "started_at": None,
    "completed_at": None,
    "jobs_imported": 0,
    "output_file": None,
    "logs": [],
    "pid": None,
}


def resolve_db_path() -> Path:
    return Path(os.getenv("JOBS_DB_PATH", str(DEFAULT_DB_PATH)))


def resolve_snapshot_path() -> Path:
    return Path(os.getenv("JOBS_SNAPSHOT_PATH", str(DEFAULT_SNAPSHOT)))
TECH_KEYWORDS = [
    "python",
    "sql",
    "pyspark",
    "apache spark",
    "spark",
    "databricks",
    "ibm datastage",
    "datastage",
    "apache airflow",
    "airflow",
    "db2",
    "postgresql",
    "mysql",
    "power bi",
    "n8n",
    "power automate",
    "selenium",
    "rest api",
    "json",
    "gcp",
    "docker",
    "kafka",
    "aws",
    "azure",
    "terraform",
    "snowflake",
    "dbt",
    "git",
    "github",
    "linux",
    "mongodb",
    "oracle",
    "tableau",
    "looker",
    "excel",
]

RESUME_EXTENSIONS = {".pdf", ".docx", ".txt"}
TECH_ALIASES = {
    "apache spark": "spark",
    "pyspark": "pyspark",
    "apache airflow": "airflow",
    "ibm datastage": "datastage",
}
STOPWORDS = {
    "para", "com", "das", "dos", "uma", "the", "and", "from", "that", "this",
    "experiencia", "conhecimento", "dados", "data", "trabalho", "projeto", "projetos",
    "desenvolvimento", "utilizando", "entre", "sobre", "como", "mais", "pela", "pelo",
}


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = os.getenv("CORS_ORIGIN", "*")
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response


@app.get("/api/health")
def health():
    jobs = load_jobs()
    return jsonify(
        {
            "status": "ok",
            "jobs": len(jobs),
            "csv_pattern": os.getenv("JOBS_CSV_PATTERN", DEFAULT_PATTERN),
            "storage": storage_summary(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.post("/api/reload")
def reload_jobs():
    jobs = load_jobs()
    return jsonify(
        {
            "status": "ok",
            "jobs": len(jobs),
            "storage": storage_summary(),
            "reloaded_at": datetime.now(timezone.utc).isoformat(),
        }
    )


@app.get("/api/scrape/status")
def scrape_status():
    return jsonify(current_scrape_state())


@app.post("/api/scrape")
def scrape_start():
    payload = request.get_json(silent=True) or {}
    sources = parse_scrape_sources(payload.get("sources", ["public"]))
    invalid_sources = sorted(set(sources) - SCRAPER_SOURCES)
    if not sources:
        return jsonify({"error": "Selecione ao menos uma fonte."}), 400
    if invalid_sources:
        return jsonify({"error": f"Fontes não suportadas: {', '.join(invalid_sources)}"}), 400

    query = clean(payload.get("query"))
    if len(query) > 4000:
        return jsonify({"error": "Os termos de busca excedem o limite de 4.000 caracteres."}), 400

    with SCRAPE_LOCK:
        if SCRAPE_STATE["status"] == "running":
            return jsonify({"error": "Já existe uma coleta em andamento.", **current_scrape_state_unlocked()}), 409
        started_at = datetime.now(timezone.utc)
        output_path = RAW_DIR / f"vagas-manual-{started_at.strftime('%Y%m%d-%H%M%S')}.csv"
        SCRAPE_STATE.update(
            {
                "status": "running",
                "message": "Preparando o coletor Go...",
                "sources": sources,
                "started_at": started_at.isoformat(),
                "completed_at": None,
                "jobs_imported": 0,
                "output_file": str(output_path.relative_to(ROOT_DIR)),
                "logs": [],
                "pid": None,
            }
        )

    worker = threading.Thread(
        target=run_scrape_worker,
        args=(sources, query, bool(payload.get("force_refresh")), output_path),
        daemon=True,
        name="datascrap-manual-collector",
    )
    worker.start()
    return jsonify(current_scrape_state()), 202


@app.get("/api/resumes")
def resumes_index():
    return jsonify(public_resume_store(load_resume_store()))


@app.post("/api/resumes")
def resumes_create():
    uploaded = request.files.get("file")
    if not uploaded or not uploaded.filename:
        return jsonify({"error": "Selecione um currículo para importar."}), 400

    original_name = secure_filename(uploaded.filename)
    extension = Path(original_name).suffix.lower()
    if extension not in RESUME_EXTENSIONS:
        return jsonify({"error": "Formato não suportado. Use PDF, DOCX ou TXT."}), 400

    resume_id = uuid.uuid4().hex[:16]
    RESUME_DIR.mkdir(parents=True, exist_ok=True)
    stored_path = RESUME_DIR / f"{resume_id}{extension}"
    uploaded.save(stored_path)

    try:
        text = extract_resume_text(stored_path)
    except Exception as exc:
        stored_path.unlink(missing_ok=True)
        return jsonify({"error": f"Não foi possível extrair o texto: {exc}"}), 422

    if len(text.strip()) < 40:
        stored_path.unlink(missing_ok=True)
        return jsonify({"error": "O currículo não contém texto suficiente para análise."}), 422

    store = load_resume_store()
    skills = matched_technologies(text)
    item = {
        "id": resume_id,
        "name": clean(request.form.get("name")) or Path(original_name).stem,
        "filename": original_name,
        "stored_file": stored_path.name,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "text": text,
        "text_length": len(text),
        "skills": skills,
        "keywords": extract_profile_keywords(text),
    }
    store["items"].append(item)
    store["active_id"] = resume_id
    save_resume_store(store)
    return jsonify(public_resume_store(store)), 201


@app.put("/api/resumes/<resume_id>/activate")
def resumes_activate(resume_id: str):
    store = load_resume_store()
    if not any(item["id"] == resume_id for item in store["items"]):
        return jsonify({"error": "Currículo não encontrado."}), 404
    store["active_id"] = resume_id
    save_resume_store(store)
    return jsonify(public_resume_store(store))


@app.delete("/api/resumes/<resume_id>")
def resumes_delete(resume_id: str):
    store = load_resume_store()
    removed = next((item for item in store["items"] if item["id"] == resume_id), None)
    if not removed:
        return jsonify({"error": "Currículo não encontrado."}), 404
    store["items"] = [item for item in store["items"] if item["id"] != resume_id]
    if store.get("active_id") == resume_id:
        store["active_id"] = store["items"][0]["id"] if store["items"] else None
    (RESUME_DIR / removed.get("stored_file", "")).unlink(missing_ok=True)
    save_resume_store(store)
    return jsonify(public_resume_store(store))


@app.get("/api/jobs")
def jobs_index():
    jobs = apply_filters(load_jobs(), request.args)
    total = len(jobs)
    sort = request.args.get("sort", "posted_desc")
    jobs = sort_jobs(jobs, sort)

    limit = clamp_int(request.args.get("limit"), default=50, minimum=1, maximum=500)
    offset = clamp_int(request.args.get("offset"), default=0, minimum=0, maximum=max(total, 0))
    page = jobs[offset : offset + limit]

    return jsonify(
        {
            "total": total,
            "limit": limit,
            "offset": offset,
            "sort": sort,
            "items": page,
        }
    )


@app.get("/api/jobs/<job_id>")
def jobs_show(job_id: str):
    for job in load_jobs():
        if job["id"] == job_id:
            return jsonify(job)
    return jsonify({"error": "job not found"}), 404


@app.get("/api/filters")
def filters():
    jobs = load_jobs()
    sources = sorted({job["source"] for job in jobs if job["source"]})
    locations = sorted({job["location"] for job in jobs if job["location"]})
    companies = sorted({job["company"] for job in jobs if job["company"]})
    techs = sorted({tech for job in jobs for tech in job["matched_technologies"]})
    seniorities = sorted({job["seniority"] for job in jobs if job["seniority"]})
    return jsonify(
        {
            "sources": sources,
            "locations": locations,
            "companies": companies,
            "technologies": techs,
            "seniorities": seniorities,
            "location_modes": ["remote_brazil", "brasilia", "all"],
        }
    )


@app.get("/api/storage")
def storage():
    jobs = load_jobs()
    summary = storage_summary()
    return jsonify(
        {
            "status": "ok",
            "jobs": len(jobs),
            **summary,
        }
    )


@app.get("/api/search")
def search():
    query = request.args.get("q", "").strip()
    limit = clamp_int(request.args.get("limit"), default=25, minimum=1, maximum=100)
    offset = clamp_int(request.args.get("offset"), default=0, minimum=0, maximum=10000)
    filters = {
        "source": request.args.get("source", ""),
        "company": request.args.get("company", ""),
        "location_mode": request.args.get("location_mode", ""),
        "seniority": request.args.get("seniority", ""),
    }
    total = count_search_jobs(query, resolve_db_path(), filters=filters)
    items = [normalize_job(row, row.get("source_file") or resolve_db_path().name) for row in search_jobs_from_db(query, resolve_db_path(), limit=limit, offset=offset, filters=filters)]
    return jsonify(
        {
            "query": query,
            "total": total,
            "limit": limit,
            "offset": offset,
            "items": items,
        }
    )


@app.get("/api/snapshot")
def snapshot():
    payload = build_snapshot(load_jobs())
    return jsonify(
        {
            "status": "ok",
            "storage": storage_summary(),
            "snapshot": payload,
        }
    )


@app.get("/api/insights")
def insights():
    jobs = apply_filters(load_jobs(), request.args)
    by_source = Counter(job["source"] or "desconhecida" for job in jobs)
    by_location_mode = Counter(job["location_mode"] for job in jobs)
    by_company = Counter(job["company"] for job in jobs if job["company"])
    by_seniority = Counter(job["seniority"] for job in jobs if job["seniority"])
    by_role = Counter(job["role_type"] for job in jobs if job.get("role_type"))
    by_day = Counter((job["posted_at"] or "")[:10] for job in jobs if job["posted_at"])
    by_tech = Counter(tech for job in jobs for tech in job["matched_technologies"])
    match_distribution = Counter(match_bucket(job["match_score"]) for job in jobs)
    salary_distribution = Counter(salary_bucket(job) for job in jobs)

    salaries = [
        value
        for job in jobs
        for value in [job.get("salary_min"), job.get("salary_max")]
        if isinstance(value, (int, float)) and value > 0
    ]
    with_salary = sum(1 for job in jobs if job.get("salary_min") or job.get("salary_max"))
    with_company = sum(1 for job in jobs if job.get("company"))
    with_description = sum(1 for job in jobs if job.get("description"))
    with_date = sum(1 for job in jobs if job.get("posted_at"))
    with_url = sum(1 for job in jobs if job.get("url"))
    with_tech = sum(1 for job in jobs if job.get("matched_technologies"))
    strong_matches = sum(1 for job in jobs if job.get("match_score", 0) >= 85)

    return jsonify(
        {
            "total_jobs": len(jobs),
            "sources_active": len(by_source),
            "remote_brazil_jobs": by_location_mode.get("remote_brazil", 0),
            "brasilia_jobs": by_location_mode.get("brasilia", 0),
            "with_salary": with_salary,
            "strong_matches": strong_matches,
            "average_match": round(
                sum(job.get("match_score", 0) for job in jobs) / len(jobs), 2
            )
            if jobs
            else 0,
            "salary": {
                "min": min(salaries) if salaries else None,
                "max": max(salaries) if salaries else None,
                "avg": round(sum(salaries) / len(salaries), 2) if salaries else None,
            },
            "by_source": counter_items(by_source),
            "by_location_mode": counter_items(by_location_mode),
            "by_company": counter_items(by_company, limit=10),
            "by_seniority": counter_items(by_seniority),
            "by_role": counter_items(by_role),
            "by_day": [{"date": key, "count": value} for key, value in sorted(by_day.items())],
            "by_technology": counter_items(by_tech, limit=15),
            "match_distribution": ordered_bucket_items(match_distribution, ["Baixo", "Médio", "Bom", "Forte"]),
            "salary_distribution": ordered_bucket_items(salary_distribution, ["Sem salário", "Até 8k", "8k-15k", "15k+"]),
            "data_coverage": [
                {"name": "Empresa", "count": with_company, "rate": percent(with_company, len(jobs))},
                {"name": "Descrição", "count": with_description, "rate": percent(with_description, len(jobs))},
                {"name": "Link", "count": with_url, "rate": percent(with_url, len(jobs))},
                {"name": "Data", "count": with_date, "rate": percent(with_date, len(jobs))},
                {"name": "Tecnologias", "count": with_tech, "rate": percent(with_tech, len(jobs))},
                {"name": "Salário", "count": with_salary, "rate": percent(with_salary, len(jobs))},
            ],
        }
    )


def load_jobs() -> list[dict[str, Any]]:
    db_path = resolve_db_path()
    db_jobs = cached_db_jobs(db_path)
    if db_jobs:
        return score_jobs_for_active_resume(db_jobs)

    pattern = os.getenv("JOBS_CSV_PATTERN", DEFAULT_PATTERN)
    files = collect_data_files(pattern)
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()

    for path in files:
        if not path.is_file():
            continue
        for row in read_csv(path):
            job = normalize_job(row, path.name)
            key = (job.get("url") or "").lower() or f"{job['source']}|{job['title']}|{job['company']}".lower()
            if not key or key in seen:
                continue
            seen.add(key)
            rows.append(job)

    return score_jobs_for_active_resume(rows)


def parse_scrape_sources(value: Any) -> list[str]:
    if isinstance(value, str):
        values = value.split(",")
    elif isinstance(value, list):
        values = value
    else:
        return []
    return list(dict.fromkeys(normalize(item) for item in values if normalize(item)))


def current_scrape_state_unlocked() -> dict[str, Any]:
    return {**SCRAPE_STATE, "logs": list(SCRAPE_STATE.get("logs", []))}


def current_scrape_state() -> dict[str, Any]:
    with SCRAPE_LOCK:
        return current_scrape_state_unlocked()


def update_scrape_state(**changes: Any) -> None:
    with SCRAPE_LOCK:
        SCRAPE_STATE.update(changes)


def run_scrape_worker(sources: list[str], query: str, force_refresh: bool, output_path: Path) -> None:
    go_executable = shutil.which("go")
    if not go_executable:
        update_scrape_state(
            status="error",
            message="Go não foi encontrado no PATH da API.",
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
        return

    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        go_executable,
        "run",
        "./apps/scraper-go",
        "-sources",
        ",".join(sources),
        "-out",
        str(output_path),
        "-timeout",
        "12m",
        "-min-interval",
        "2s",
        "-retries",
        "3",
        "-cache-ttl",
        "0" if force_refresh else "6h",
    ]
    if query:
        command.extend(["-query", query])

    environment = os.environ.copy()
    environment.setdefault("GOCACHE", str(ROOT_DIR / ".cache" / "go-build"))
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    try:
        process = subprocess.Popen(
            command,
            cwd=ROOT_DIR,
            env=environment,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creation_flags,
        )
        update_scrape_state(pid=process.pid, message="Coletando vagas nas fontes selecionadas...")
        stdout, _ = process.communicate(timeout=15 * 60)
    except subprocess.TimeoutExpired:
        process.kill()
        stdout, _ = process.communicate()
        finish_scrape_with_error("A coleta excedeu o limite de 15 minutos.", stdout)
        return
    except OSError as exc:
        finish_scrape_with_error(f"Não foi possível iniciar o Go: {exc}", "")
        return

    logs = scrape_log_lines(stdout)
    if process.returncode != 0:
        finish_scrape_with_error("O coletor terminou com erro. Consulte os logs.", stdout)
        return

    try:
        imported = import_scraped_jobs(output_path)
    except Exception as exc:
        finish_scrape_with_error(f"A coleta terminou, mas a importação falhou: {exc}", stdout)
        return

    update_scrape_state(
        status="completed",
        message=f"Coleta concluída. {imported} vagas sincronizadas com a base.",
        completed_at=datetime.now(timezone.utc).isoformat(),
        jobs_imported=imported,
        logs=logs,
        pid=None,
    )


def import_scraped_jobs(output_path: Path) -> int:
    rows = read_csv(output_path)
    jobs = [normalize_job(row, output_path.name) for row in rows]
    imported = upsert_jobs(jobs, db_path=resolve_db_path())
    JOB_CACHE.clear()
    SNAPSHOT_CACHE.clear()
    build_snapshot(load_jobs(), resolve_snapshot_path())
    SNAPSHOT_CACHE.clear()
    return imported


def scrape_log_lines(output: str) -> list[str]:
    normalized = output.replace("\r", "\n")
    return [line.strip() for line in normalized.splitlines() if line.strip()][-40:]


def finish_scrape_with_error(message: str, output: str) -> None:
    update_scrape_state(
        status="error",
        message=message,
        completed_at=datetime.now(timezone.utc).isoformat(),
        logs=scrape_log_lines(output),
        pid=None,
    )


def cached_db_jobs(db_path: Path) -> list[dict[str, Any]]:
    signature = file_signature(db_path)
    cache_key = str(db_path)
    cached = JOB_CACHE.get(cache_key)
    if cached and cached[0] == signature:
        return cached[1]

    db_rows = load_jobs_from_db(db_path)
    jobs: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in db_rows:
        job = normalize_job(row, row.get("source_file") or db_path.name)
        key = (job.get("url") or "").lower() or f"{job['source']}|{job['title']}|{job['company']}".lower()
        if not key or key in seen:
            continue
        seen.add(key)
        jobs.append(job)

    JOB_CACHE[cache_key] = (signature, jobs)
    return jobs


def load_snapshot() -> dict[str, Any]:
    path = resolve_snapshot_path()
    signature = file_signature(path)
    cache_key = str(path)
    cached = SNAPSHOT_CACHE.get(cache_key)
    if cached and cached[0] == signature:
        return cached[1]

    if path.exists():
        with path.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    else:
        payload = build_snapshot(load_jobs(), path)

    SNAPSHOT_CACHE[cache_key] = (signature, payload)
    return payload


def load_resume_store() -> dict[str, Any]:
    if not RESUME_STORE.exists():
        return {"active_id": None, "items": []}
    try:
        with RESUME_STORE.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"active_id": None, "items": []}
    return {
        "active_id": payload.get("active_id"),
        "items": payload.get("items", []),
    }


def save_resume_store(store: dict[str, Any]) -> None:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    temporary = RESUME_STORE.with_suffix(".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(store, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    temporary.replace(RESUME_STORE)
    SNAPSHOT_CACHE.clear()


def public_resume_store(store: dict[str, Any]) -> dict[str, Any]:
    active_id = store.get("active_id")
    items = []
    for resume in store.get("items", []):
        items.append(
            {
                "id": resume.get("id"),
                "name": resume.get("name"),
                "filename": resume.get("filename"),
                "uploaded_at": resume.get("uploaded_at"),
                "text_length": resume.get("text_length", 0),
                "skills": canonical_skills(resume.get("skills", [])),
                "keyword_count": len(resume.get("keywords", [])),
                "active": resume.get("id") == active_id,
            }
        )
    return {"active_id": active_id, "items": items}


def active_resume() -> dict[str, Any] | None:
    store = load_resume_store()
    active_id = store.get("active_id")
    return next((item for item in store.get("items", []) if item.get("id") == active_id), None)


def extract_resume_text(path: Path) -> str:
    extension = path.suffix.lower()
    if extension == ".txt":
        for encoding in ["utf-8-sig", "utf-8", "cp1252"]:
            try:
                return path.read_text(encoding=encoding)
            except UnicodeDecodeError:
                continue
        raise ValueError("codificação de texto não reconhecida")
    if extension == ".docx":
        return extract_docx_text(path)
    if extension == ".pdf":
        return extract_pdf_text(path)
    raise ValueError("formato não suportado")


def extract_pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(str(path))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        if text.strip():
            return text
    except ImportError:
        pass
    except Exception as exc:
        raise ValueError(f"PDF inválido ({exc})") from exc

    executable = shutil.which("pdftotext")
    if executable:
        result = subprocess.run(
            [executable, "-layout", str(path), "-"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout
    raise ValueError("instale pypdf ou pdftotext para processar arquivos PDF")


def extract_docx_text(path: Path) -> str:
    try:
        with zipfile.ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile) as exc:
        raise ValueError("arquivo DOCX inválido") from exc
    root = ElementTree.fromstring(xml)
    return " ".join(node.text for node in root.iter() if node.tag.endswith("}t") and node.text)


def extract_profile_keywords(text: str) -> list[str]:
    words = re.findall(r"[a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9+#.-]{2,}", text)
    counts = Counter(normalize(word) for word in words)
    return [
        word
        for word, _ in counts.most_common(80)
        if word not in STOPWORDS and len(word) >= 3
    ][:50]


def score_jobs_for_active_resume(jobs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    resume = active_resume()
    return [score_job_for_resume(job, resume) for job in jobs]


def score_job_for_resume(job: dict[str, Any], resume: dict[str, Any] | None) -> dict[str, Any]:
    scored = {**job}
    if not resume:
        scored.update(
            {
                "match_score": 0,
                "match_available": False,
                "profile_matched_technologies": [],
                "match_components": {"technology": 0, "title": 0, "role": 0, "description_penalty": 0},
            }
        )
        return scored

    resume_skills = {normalize(skill): skill for skill in canonical_skills(resume.get("skills", []))}
    job_skills = {normalize(skill): skill for skill in job.get("matched_technologies", [])}
    common_keys = set(resume_skills) & set(job_skills)
    matched_skills = sorted(job_skills[key] for key in common_keys)
    technology_score = round(65 * len(common_keys) / max(1, len(job_skills))) if job_skills else 0

    title_tokens = {
        normalize(token)
        for token in re.findall(r"[a-zA-ZÀ-ÿ][a-zA-ZÀ-ÿ0-9+#.-]{2,}", job.get("title", ""))
        if normalize(token) not in STOPWORDS
    }
    resume_keywords = set(resume.get("keywords", []))
    title_overlap = len(title_tokens & resume_keywords)
    title_score = round(20 * title_overlap / max(1, min(len(title_tokens), 6)))

    resume_text = normalize(resume.get("text", ""))
    role_terms = [term for term in normalize(job.get("role_type", "")).split() if term not in STOPWORDS]
    role_score = 15 if job.get("role_type") != "Outros" and any(term in resume_text for term in role_terms) else 0
    description_penalty = 10 if not job.get("description") else 0
    score = max(0, min(100, technology_score + title_score + role_score - description_penalty))

    scored.update(
        {
            "match_score": score,
            "match_available": True,
            "profile_matched_technologies": matched_skills,
            "match_components": {
                "technology": technology_score,
                "title": title_score,
                "role": role_score,
                "description_penalty": description_penalty,
            },
        }
    )
    return scored




def collect_data_files(pattern: str) -> list[Path]:
    for base in [PROCESSED_DIR, RAW_DIR, ROOT_DIR]:
        if not base.exists():
            continue
        candidates = [
            path
            for path in sorted(base.glob(pattern))
            if path.is_file()
        ]
        if candidates:
            return candidates
    return []


def file_signature(path: Path) -> tuple[int, int]:
    try:
        stat = path.stat()
    except FileNotFoundError:
        return (0, 0)
    return (stat.st_mtime_ns, stat.st_size)


def build_snapshot(jobs: list[dict[str, Any]], output_path: Path | None = None) -> dict[str, Any]:
    by_source = Counter(job["source"] or "desconhecida" for job in jobs)
    by_location_mode = Counter(job["location_mode"] for job in jobs)
    by_company = Counter(job["company"] for job in jobs if job["company"])
    by_seniority = Counter(job["seniority"] for job in jobs if job["seniority"])
    by_day = Counter((job["posted_at"] or "")[:10] for job in jobs if job["posted_at"])
    by_tech = Counter(tech for job in jobs for tech in job["matched_technologies"])

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_jobs": len(jobs),
        "sources_active": len(by_source),
        "remote_brazil_jobs": by_location_mode.get("remote_brazil", 0),
        "brasilia_jobs": by_location_mode.get("brasilia", 0),
        "with_salary": sum(1 for job in jobs if job.get("salary_min") or job.get("salary_max")),
        "average_match": round(sum(job.get("match_score", 0) for job in jobs) / len(jobs), 2) if jobs else 0,
        "strong_matches": sum(1 for job in jobs if job.get("match_score", 0) >= 85),
        "by_source": counter_items(by_source),
        "by_location_mode": counter_items(by_location_mode),
        "by_company": counter_items(by_company, limit=10),
        "by_seniority": counter_items(by_seniority),
        "by_day": [{"date": key, "count": value} for key, value in sorted(by_day.items())],
        "by_technology": counter_items(by_tech, limit=15),
        "top_jobs": [
            {
                "id": job["id"],
                "title": job["title"],
                "company": job["company"],
                "location": job["location"],
                "match_score": job["match_score"],
                "source": job["source"],
            }
            for job in sorted(jobs, key=lambda item: (item["match_score"], item["posted_at"]), reverse=True)[:10]
        ],
    }

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    return payload


def storage_summary() -> dict[str, Any]:
    csv_pattern = os.getenv("JOBS_CSV_PATTERN", DEFAULT_PATTERN)
    csv_files = collect_data_files(csv_pattern)
    db_path = resolve_db_path()
    snapshot_path = resolve_snapshot_path()
    db_jobs = count_db_jobs(db_path)
    source = "database" if db_jobs else ("csv" if csv_files else "empty")
    return {
        "source": source,
        "database_path": str(db_path),
        "database_jobs": db_jobs,
        "snapshot_path": str(snapshot_path),
        "snapshot_exists": snapshot_path.exists(),
        "csv_pattern": csv_pattern,
        "csv_files": [path.name for path in csv_files],
    }


def read_csv(path: Path) -> list[dict[str, str]]:
    for encoding in ["utf-8-sig", "utf-8", "cp1252"]:
        try:
            with path.open("r", newline="", encoding=encoding) as file:
                return list(csv.DictReader(file))
        except UnicodeDecodeError:
            continue
    return []


def normalize_job(row: dict[str, str], source_file: str) -> dict[str, Any]:
    title = clean(row.get("title"))
    company = clean(row.get("company"))
    source = clean(row.get("source"))
    location = clean(row.get("location"))
    url = clean(row.get("url"))
    tags = clean(row.get("tags"))
    posted_at = clean(row.get("posted_at"))
    collected_at = clean(first_present(row, "collected_at", "scraped_at", "created_at", "coletado_em"))
    description = clean(first_present(row, "description", "job_description", "jobDescription", "descricao"))
    search_text = " ".join([title, description, company, location, tags, url])
    matched = matched_technologies(search_text)

    job = {
        "id": stable_id(url or f"{source}|{title}|{company}|{location}"),
        "source": source,
        "source_file": source_file,
        "title": title,
        "description": description,
        "company": company,
        "company_logo": clean(row.get("company_logo")),
        "location": location,
        "location_mode": location_mode(location, search_text),
        "url": url,
        "tags": split_tags(tags),
        "posted_at": posted_at,
        "collected_at": collected_at,
        "salary_min": parse_float(row.get("salary_min")),
        "salary_max": parse_float(row.get("salary_max")),
        "salary_currency": clean(row.get("salary_currency")),
        "salary_period": clean(row.get("salary_period")),
        "matched_technologies": matched,
        "profile_matched_technologies": [],
        "match_score": 0,
        "match_available": False,
    }
    job["seniority"] = seniority_label(search_text)
    job["role_type"] = role_type(search_text)
    return job


def apply_filters(jobs: list[dict[str, Any]], args) -> list[dict[str, Any]]:
    q = normalize(args.get("q", ""))
    source = normalize(args.get("source", ""))
    company = normalize(args.get("company", ""))
    tech = normalize(args.get("tech", ""))
    location_filter = normalize(args.get("location_mode", ""))
    salary = normalize(args.get("salary", ""))
    city = normalize(args.get("city", ""))
    seniority = normalize(args.get("seniority", ""))
    has_description = normalize(args.get("has_description", "")) in {"1", "true", "yes", "sim"}
    remote_only = normalize(args.get("remote_only", "")) in {"1", "true", "yes", "sim"}
    strong_match = normalize(args.get("strong_match", "")) in {"1", "true", "yes", "sim"}
    days = clamp_int(args.get("days"), default=0, minimum=0, maximum=3650)
    min_salary = parse_float(args.get("min_salary"))
    max_salary = parse_float(args.get("max_salary"))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days) if days else None

    filtered = []
    for job in jobs:
        text = normalize(" ".join([job["title"], job.get("description", ""), job["company"], job["location"], " ".join(job["tags"])]))
        if q and q not in text:
            continue
        if source and source != normalize(job["source"]):
            continue
        if company and company not in normalize(job["company"]):
            continue
        if tech and tech not in [normalize(item) for item in job["matched_technologies"]]:
            continue
        if location_filter and location_filter != "all" and location_filter != job["location_mode"]:
            continue
        if city and city not in normalize(job["location"]):
            continue
        if seniority and seniority != "all" and seniority != normalize(job["seniority"]):
            continue
        if salary == "with_salary" and not (job.get("salary_min") or job.get("salary_max")):
            continue
        if has_description and not job.get("description"):
            continue
        if remote_only and job.get("location_mode") != "remote_brazil":
            continue
        if strong_match and job.get("match_score", 0) < 85:
            continue
        if min_salary is not None and not salary_overlaps(job, min_salary=min_salary, max_salary=None):
            continue
        if max_salary is not None and not salary_overlaps(job, min_salary=None, max_salary=max_salary):
            continue
        if cutoff:
            posted = parse_date(job.get("posted_at"))
            if not posted or posted < cutoff:
                continue
        filtered.append(job)
    return filtered


def sort_jobs(jobs: list[dict[str, Any]], sort: str) -> list[dict[str, Any]]:
    if sort == "match_desc":
        return sorted(jobs, key=lambda job: (job["match_score"], job["posted_at"]), reverse=True)
    if sort == "salary_desc":
        return sorted(jobs, key=lambda job: (salary_sort_value(job), job["match_score"], job["posted_at"]), reverse=True)
    if sort == "company_asc":
        return sorted(jobs, key=lambda job: (job["company"], job["title"]))
    if sort == "source_asc":
        return sorted(jobs, key=lambda job: (job["source"], job["posted_at"]), reverse=True)
    if sort == "seniority_asc":
        return sorted(jobs, key=lambda job: (job["seniority"], job["match_score"]), reverse=True)
    return sorted(jobs, key=lambda job: (job["posted_at"], job["match_score"]), reverse=True)


def salary_sort_value(job: dict[str, Any]) -> float:
    values = [
        value
        for value in [job.get("salary_min"), job.get("salary_max")]
        if isinstance(value, (int, float))
    ]
    return sum(values) / len(values) if values else 0


def location_mode(location: str, text: str) -> str:
    normalized_location = searchable(location)
    normalized_text = searchable(text)
    if any(term in f" {normalized_location} " for term in [" brasilia ", " distrito federal ", " df "]):
        return "brasilia"
    if is_remote(normalized_text) and is_brazil_or_latam(normalized_text):
        return "remote_brazil"
    return "other"


def matched_technologies(text: str) -> list[str]:
    normalized = normalize(text)
    return canonical_skills(tech for tech in TECH_KEYWORDS if normalize(tech) in normalized)


def canonical_skills(skills) -> list[str]:
    return sorted({TECH_ALIASES.get(normalize(skill), skill) for skill in skills})


def seniority_label(text: str) -> str:
    normalized = searchable(text)
    padded = f" {normalized} "
    if any(term in padded for term in [" estagio ", " estagiario ", " intern ", " internship "]):
        return "Estagio"
    if any(term in padded for term in [" junior ", " jr ", " trainee "]):
        return "Junior"
    if any(term in padded for term in [" especialista ", " specialist ", " staff ", " principal "]):
        return "Especialista"
    if any(term in padded for term in [" senior ", " sr ", " lead "]):
        return "Senior"
    if any(term in padded for term in [" pleno ", " mid ", " pleno senior "]):
        return "Pleno"
    return "Nao informado"


def role_type(text: str) -> str:
    normalized = searchable(text)
    padded = f" {normalized} "
    if any(term in padded for term in [" engenheiro de dados ", " data engineer ", " engenharia de dados "]):
        return "Engenharia de Dados"
    if any(term in padded for term in [" analista de dados ", " data analyst ", " bi analyst ", " business intelligence "]):
        return "Análise de Dados"
    if any(term in padded for term in [" desenvolvedor python ", " python developer ", " backend python "]):
        return "Desenvolvimento Python"
    if any(term in padded for term in [" cientista de dados ", " data scientist ", " machine learning "]):
        return "Ciência de Dados"
    return "Outros"


def match_bucket(score: Any) -> str:
    try:
        value = int(score)
    except (TypeError, ValueError):
        value = 0
    if value >= 85:
        return "Forte"
    if value >= 70:
        return "Bom"
    if value >= 40:
        return "Médio"
    return "Baixo"


def salary_bucket(job: dict[str, Any]) -> str:
    values = [
        value
        for value in [job.get("salary_min"), job.get("salary_max")]
        if isinstance(value, (int, float)) and value > 0
    ]
    if not values:
        return "Sem salário"
    midpoint = sum(values) / len(values)
    if midpoint < 8000:
        return "Até 8k"
    if midpoint < 15000:
        return "8k-15k"
    return "15k+"


def percent(part: int, total: int) -> float:
    return round((part / total) * 100, 1) if total else 0


def salary_overlaps(job: dict[str, Any], min_salary: float | None, max_salary: float | None) -> bool:
    salary_min = job.get("salary_min")
    salary_max = job.get("salary_max")
    values = [value for value in [salary_min, salary_max] if isinstance(value, (int, float)) and value > 0]
    if not values:
        return False
    low = min(values)
    high = max(values)
    if min_salary is not None and high < min_salary:
        return False
    if max_salary is not None and low > max_salary:
        return False
    return True


def is_remote(text: str) -> bool:
    return any(term in text for term in ["remote", "remoto", "home office", "work from home"])


def is_brazil_or_latam(text: str) -> bool:
    padded = f" {searchable(text)} "
    return any(
        term in padded
        for term in [" brasil ", " brazil ", " br ", " latam ", " latin america ", " america latina "]
    )


def split_tags(tags: str) -> list[str]:
    return [item.strip() for item in re.split(r"[|,]", tags or "") if item.strip()]


def first_present(row: dict[str, Any], *names: str) -> Any:
    for name in names:
        value = row.get(name)
        if clean(value):
            return value
    return ""


def parse_float(value: Any) -> float | None:
    value = clean(value)
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def parse_date(value: Any) -> datetime | None:
    text = clean(value)
    if not text:
        return None
    candidates = [text, text.replace("Z", "+00:00")]
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc)
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(text[:10], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text.lower() == "nan":
        return ""
    return re.sub(r"\s+", " ", text)


def normalize(value: Any) -> str:
    text = clean(value).lower()
    replacements = {
        "á": "a",
        "à": "a",
        "â": "a",
        "ã": "a",
        "é": "e",
        "ê": "e",
        "í": "i",
        "ó": "o",
        "ô": "o",
        "õ": "o",
        "ú": "u",
        "ç": "c",
    }
    for original, replacement in replacements.items():
        text = text.replace(original, replacement)
    return text


def searchable(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", normalize(value)).strip()


def stable_id(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8", errors="ignore")).hexdigest()[:16]


def counter_items(counter: Counter, limit: int | None = None) -> list[dict[str, Any]]:
    items = [{"name": key, "count": value} for key, value in counter.most_common(limit)]
    return items


def ordered_bucket_items(counter: Counter, order: list[str]) -> list[dict[str, Any]]:
    return [{"name": key, "count": counter.get(key, 0)} for key in order]


def clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(parsed, maximum))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")), debug=True)

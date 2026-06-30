from __future__ import annotations

import csv
import hashlib
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request


ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_PATTERN = "vagas*.csv"

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
]


app = Flask(__name__)


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = os.getenv("CORS_ORIGIN", "*")
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    return response


@app.get("/api/health")
def health():
    jobs = load_jobs()
    return jsonify(
        {
            "status": "ok",
            "jobs": len(jobs),
            "csv_pattern": os.getenv("JOBS_CSV_PATTERN", DEFAULT_PATTERN),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
    )


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
    return jsonify(
        {
            "sources": sources,
            "locations": locations,
            "companies": companies,
            "technologies": techs,
            "location_modes": ["remote_brazil", "brasilia", "all"],
        }
    )


@app.get("/api/insights")
def insights():
    jobs = apply_filters(load_jobs(), request.args)
    by_source = Counter(job["source"] or "desconhecida" for job in jobs)
    by_location_mode = Counter(job["location_mode"] for job in jobs)
    by_company = Counter(job["company"] for job in jobs if job["company"])
    by_day = Counter((job["posted_at"] or "")[:10] for job in jobs if job["posted_at"])
    by_tech = Counter(tech for job in jobs for tech in job["matched_technologies"])

    salaries = [
        value
        for job in jobs
        for value in [job.get("salary_min"), job.get("salary_max")]
        if isinstance(value, (int, float)) and value > 0
    ]

    return jsonify(
        {
            "total_jobs": len(jobs),
            "sources_active": len(by_source),
            "remote_brazil_jobs": by_location_mode.get("remote_brazil", 0),
            "brasilia_jobs": by_location_mode.get("brasilia", 0),
            "with_salary": sum(1 for job in jobs if job.get("salary_min") or job.get("salary_max")),
            "average_match": round(
                sum(len(job["matched_technologies"]) for job in jobs) / len(jobs), 2
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
            "by_day": [{"date": key, "count": value} for key, value in sorted(by_day.items())],
            "by_technology": counter_items(by_tech, limit=15),
        }
    )


def load_jobs() -> list[dict[str, Any]]:
    pattern = os.getenv("JOBS_CSV_PATTERN", DEFAULT_PATTERN)
    files = sorted(ROOT_DIR.glob(pattern))
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

    return rows


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
    search_text = " ".join([title, company, location, tags, url])
    matched = matched_technologies(search_text)

    job = {
        "id": stable_id(url or f"{source}|{title}|{company}|{location}"),
        "source": source,
        "source_file": source_file,
        "title": title,
        "company": company,
        "company_logo": clean(row.get("company_logo")),
        "location": location,
        "location_mode": location_mode(location, search_text),
        "url": url,
        "tags": split_tags(tags),
        "posted_at": posted_at,
        "salary_min": parse_float(row.get("salary_min")),
        "salary_max": parse_float(row.get("salary_max")),
        "salary_currency": clean(row.get("salary_currency")),
        "salary_period": clean(row.get("salary_period")),
        "matched_technologies": matched,
        "match_score": len(matched),
    }
    return job


def apply_filters(jobs: list[dict[str, Any]], args) -> list[dict[str, Any]]:
    q = normalize(args.get("q", ""))
    source = normalize(args.get("source", ""))
    company = normalize(args.get("company", ""))
    tech = normalize(args.get("tech", ""))
    location_filter = normalize(args.get("location_mode", ""))
    salary = normalize(args.get("salary", ""))

    filtered = []
    for job in jobs:
        text = normalize(" ".join([job["title"], job["company"], job["location"], " ".join(job["tags"])]))
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
        if salary == "with_salary" and not (job.get("salary_min") or job.get("salary_max")):
            continue
        filtered.append(job)
    return filtered


def sort_jobs(jobs: list[dict[str, Any]], sort: str) -> list[dict[str, Any]]:
    if sort == "match_desc":
        return sorted(jobs, key=lambda job: (job["match_score"], job["posted_at"]), reverse=True)
    if sort == "company_asc":
        return sorted(jobs, key=lambda job: (job["company"], job["title"]))
    return sorted(jobs, key=lambda job: (job["posted_at"], job["match_score"]), reverse=True)


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
    return sorted({tech for tech in TECH_KEYWORDS if normalize(tech) in normalized})


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


def parse_float(value: Any) -> float | None:
    value = clean(value)
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
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


def clamp_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(parsed, maximum))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")), debug=True)

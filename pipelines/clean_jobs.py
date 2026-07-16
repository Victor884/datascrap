from __future__ import annotations

import argparse
import csv
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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

SENIORITY_MARKERS = {
    "Estagio": [" estagio ", " estagiario ", " intern ", " internship "],
    "Junior": [" junior ", " jr ", " trainee "],
    "Pleno": [" pleno ", " mid ", " pleno senior "],
    "Senior": [" senior ", " sr ", " lead "],
    "Especialista": [" especialista ", " specialist ", " staff ", " principal "],
}

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_INPUT_DIR = ROOT_DIR / "data" / "raw"
DEFAULT_OUTPUT = ROOT_DIR / "data" / "processed" / "vagas-processadas.csv"


def clean(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return ""
    return re.sub(r"\s+", " ", text)


def normalize(value: Any) -> str:
    text = clean(value).lower()
    for original, replacement in {
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
    }.items():
        text = text.replace(original, replacement)
    return text


def searchable(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", normalize(value)).strip()


def split_tags(value: Any) -> list[str]:
    text = clean(value)
    if not text:
        return []
    parts = re.split(r"[|,;/]", text)
    return [clean(part) for part in parts if clean(part)]


def parse_float(value: Any) -> float | None:
    text = clean(value)
    if not text:
        return None
    text = re.sub(r"[^0-9,.-]", "", text)
    if not text:
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    else:
        text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return None


def parse_date(value: Any) -> str:
    text = clean(value)
    if not text:
        return ""

    if text.isdigit():
        try:
            return datetime.fromtimestamp(int(text), tz=timezone.utc).isoformat()
        except (OSError, ValueError):
            pass

    candidates = [text, text.replace("Z", "+00:00")]
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()

    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y"):
        try:
            parsed = datetime.strptime(text[:10], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        return parsed.isoformat()

    return text


def stable_id(value: str) -> str:
    return hashlib.sha1(value.encode("utf-8", errors="ignore")).hexdigest()[:16]


def is_remote(text: Any) -> bool:
    normalized = searchable(text)
    return any(term in normalized for term in ["remote", "remoto", "home office", "work from home"])


def is_brazil_or_latam(text: Any) -> bool:
    padded = f" {searchable(text)} "
    return any(
        term in padded
        for term in [" brasil ", " brazil ", " br ", " latam ", " latin america ", " america latina "]
    )


def location_mode(location: str, text: str) -> str:
    padded_location = f" {searchable(location)} "
    if any(term in padded_location for term in [" brasilia ", " distrito federal ", " df "]):
        return "brasilia"
    if is_remote(text) and is_brazil_or_latam(text):
        return "remote_brazil"
    return "other"


def matched_technologies(text: str) -> list[str]:
    normalized = normalize(text)
    return sorted({tech for tech in TECH_KEYWORDS if normalize(tech) in normalized})


def seniority_label(text: str) -> str:
    padded = f" {searchable(text)} "
    for label, markers in SENIORITY_MARKERS.items():
        if any(marker in padded for marker in markers):
            return label
    return "Nao informado"


def is_test_file(path: Path) -> bool:
    stem = path.stem.lower()
    return bool(re.search(r"(^|[-_.])(test|teste)([-_.]|$)", stem))


def first_value(row: dict[str, str], *names: str) -> str:
    for name in names:
        if name in row:
            value = clean(row.get(name))
            if value:
                return value
    return ""


def normalize_row(row: dict[str, str], source_file: str) -> dict[str, Any]:
    source = first_value(row, "source", "site")
    title = first_value(row, "title", "jobTitle", "job_title")
    description = first_value(row, "description", "jobDescription", "job_description", "descricao")
    company = first_value(row, "company", "companyName", "company_name")
    company_logo = first_value(row, "company_logo", "companyLogo", "company_logo_url")
    location = first_value(row, "location", "jobGeo", "location_name")
    url = first_value(row, "url", "job_url", "job_url_direct", "link", "redirect_url")
    tags = split_tags(first_value(row, "tags", "job_type", "jobIndustry", "category"))
    posted_at = parse_date(first_value(row, "posted_at", "date_posted", "pubDate", "publication_date", "created_at", "created"))
    salary_min = parse_float(first_value(row, "salary_min", "min_amount"))
    salary_max = parse_float(first_value(row, "salary_max", "max_amount"))
    salary_currency = first_value(row, "salary_currency", "currency")
    salary_period = first_value(row, "salary_period", "interval")

    search_text = " ".join([title, description, company, location, " ".join(tags), url])
    technologies = matched_technologies(search_text)
    unique_key = url or f"{source}|{title}|{company}|{location}"

    return {
        "id": stable_id(unique_key),
        "source": source,
        "source_file": source_file,
        "title": title,
        "description": description,
        "company": company,
        "company_logo": company_logo,
        "location": location,
        "location_mode": location_mode(location, search_text),
        "is_remote": "yes" if is_remote(search_text) else "no",
        "url": url,
        "tags": "|".join(tags),
        "posted_at": posted_at,
        "salary_min": salary_min,
        "salary_max": salary_max,
        "salary_currency": salary_currency,
        "salary_period": salary_period,
        "matched_technologies": "|".join(technologies),
        "match_score": len(technologies),
        "seniority": seniority_label(search_text),
        "cleaned_at": datetime.now(timezone.utc).isoformat(),
    }


def collect_input_files(input_dir: Path, pattern: str, include_tests: bool) -> list[Path]:
    files = []
    for path in sorted(input_dir.glob(pattern)):
        if not path.is_file():
            continue
        if not include_tests and is_test_file(path):
            continue
        files.append(path)
    return files


def read_csv(path: Path) -> list[dict[str, str]]:
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            with path.open("r", newline="", encoding=encoding) as handle:
                return list(csv.DictReader(handle))
        except UnicodeDecodeError:
            continue
    raise UnicodeDecodeError("csv", b"", 0, 1, f"Unable to decode {path}")


def clean_jobs(input_dir: Path, pattern: str, output: Path, include_tests: bool) -> tuple[int, int]:
    files = collect_input_files(input_dir, pattern, include_tests)
    output.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = [
        "id",
        "source",
        "source_file",
        "title",
        "description",
        "company",
        "company_logo",
        "location",
        "location_mode",
        "is_remote",
        "url",
        "tags",
        "posted_at",
        "salary_min",
        "salary_max",
        "salary_currency",
        "salary_period",
        "matched_technologies",
        "match_score",
        "seniority",
        "cleaned_at",
    ]

    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for path in files:
        for raw_row in read_csv(path):
            normalized = normalize_row(raw_row, path.name)
            key = (normalized.get("url") or "").lower() or normalized["id"]
            if key in seen:
                continue
            seen.add(key)
            rows.append(normalized)

    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, quoting=csv.QUOTE_NONNUMERIC, escapechar="\\")
        writer.writeheader()
        writer.writerows(rows)

    return len(files), len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Limpa os CSVs raw e gera a base canônica em data/processed.")
    parser.add_argument("--input-dir", default=str(DEFAULT_INPUT_DIR), help="Diretório com CSVs brutos.")
    parser.add_argument("--pattern", default="vagas*.csv", help="Pattern dos arquivos raw.")
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT), help="Arquivo CSV processado.")
    parser.add_argument("--include-tests", action="store_true", help="Inclui CSVs com teste no nome.")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output = Path(args.out)
    files, rows = clean_jobs(input_dir, args.pattern, output, args.include_tests)
    print(f"Pronto: {rows} vagas processadas a partir de {files} arquivos em {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

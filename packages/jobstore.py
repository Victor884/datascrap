from __future__ import annotations

import csv
import sqlite3
from pathlib import Path
from typing import Any, Iterable

ROOT_DIR = Path(__file__).resolve().parents[1]
WAREHOUSE_DIR = ROOT_DIR / "data" / "warehouse"
DEFAULT_DB_PATH = WAREHOUSE_DIR / "jobs.sqlite3"
JOB_COLUMNS = [
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

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_file TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    company TEXT,
    company_logo TEXT,
    location TEXT,
    location_mode TEXT,
    is_remote TEXT,
    url TEXT,
    tags TEXT,
    posted_at TEXT,
    salary_min REAL,
    salary_max REAL,
    salary_currency TEXT,
    salary_period TEXT,
    matched_technologies TEXT,
    match_score INTEGER,
    seniority TEXT,
    cleaned_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_location_mode ON jobs(location_mode);
CREATE INDEX IF NOT EXISTS idx_jobs_seniority ON jobs(seniority);
CREATE INDEX IF NOT EXISTS idx_jobs_match_score ON jobs(match_score DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(
    id UNINDEXED,
    title,
    description,
    company,
    location,
    tags,
    matched_technologies,
    source,
    seniority,
    content='',
    tokenize='porter'
);
"""

UPSERT_SQL = f"""
INSERT INTO jobs ({', '.join(JOB_COLUMNS)})
VALUES ({', '.join(['?'] * len(JOB_COLUMNS))})
ON CONFLICT(id) DO UPDATE SET
    source = excluded.source,
    title = excluded.title,
    description = excluded.description,
    company = excluded.company,
    company_logo = excluded.company_logo,
    location = excluded.location,
    location_mode = excluded.location_mode,
    is_remote = excluded.is_remote,
    url = excluded.url,
    tags = excluded.tags,
    posted_at = excluded.posted_at,
    salary_min = excluded.salary_min,
    salary_max = excluded.salary_max,
    salary_currency = excluded.salary_currency,
    salary_period = excluded.salary_period,
    matched_technologies = excluded.matched_technologies,
    match_score = excluded.match_score,
    seniority = excluded.seniority,
    cleaned_at = excluded.cleaned_at
"""

SELECT_SQL = f"SELECT {', '.join(JOB_COLUMNS)} FROM jobs ORDER BY COALESCE(posted_at, '') DESC, match_score DESC, company ASC, title ASC"
SEARCH_SELECT_SQL = f"SELECT {', '.join('j.' + column for column in JOB_COLUMNS)} FROM jobs_fts f JOIN jobs j ON j.rowid = f.rowid"
SEARCH_FIELDS = ("source", "company", "location_mode", "seniority")


def database_path(db_path: str | Path | None = None) -> Path:
    return Path(db_path) if db_path else DEFAULT_DB_PATH


def connect(db_path: str | Path | None = None) -> sqlite3.Connection:
    path = database_path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(CREATE_TABLE_SQL)
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}
    if "description" not in columns:
        conn.execute("ALTER TABLE jobs ADD COLUMN description TEXT")
    fts_columns = {row["name"] for row in conn.execute("PRAGMA table_info(jobs_fts)").fetchall()}
    if "description" not in fts_columns:
        conn.execute("DROP TABLE IF EXISTS jobs_fts")
        conn.execute(
            """
            CREATE VIRTUAL TABLE jobs_fts USING fts5(
                id UNINDEXED,
                title,
                description,
                company,
                location,
                tags,
                matched_technologies,
                source,
                seniority,
                content='',
                tokenize='porter'
            )
            """
        )


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return ""
    return text


def clean_numeric(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean_integer(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def clean_list_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple, set)):
        parts = [clean_text(item) for item in value]
        return "|".join(part for part in parts if part)
    return clean_text(value)


def prepare_row(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        clean_text(row.get("id")),
        clean_text(row.get("source")),
        clean_text(row.get("source_file")),
        clean_text(row.get("title")),
        clean_text(row.get("description")),
        clean_text(row.get("company")),
        clean_text(row.get("company_logo")),
        clean_text(row.get("location")),
        clean_text(row.get("location_mode")),
        clean_text(row.get("is_remote")),
        clean_text(row.get("url")),
        clean_list_text(row.get("tags")),
        clean_text(row.get("posted_at")),
        clean_numeric(row.get("salary_min")),
        clean_numeric(row.get("salary_max")),
        clean_text(row.get("salary_currency")),
        clean_text(row.get("salary_period")),
        clean_list_text(row.get("matched_technologies")),
        clean_integer(row.get("match_score")),
        clean_text(row.get("seniority")),
        clean_text(row.get("cleaned_at")),
    )


def row_to_search_columns(row: dict[str, Any]) -> tuple[Any, ...]:
    return (
        clean_text(row.get("id")),
        clean_text(row.get("title")),
        clean_text(row.get("description")),
        clean_text(row.get("company")),
        clean_text(row.get("location")),
        clean_text(row.get("tags")),
        clean_text(row.get("matched_technologies")),
        clean_text(row.get("source")),
        clean_text(row.get("seniority")),
    )


def refresh_search_index(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM jobs_fts")
    rows = conn.execute(
        "SELECT rowid, id, title, description, company, location, tags, matched_technologies, source, seniority FROM jobs"
    ).fetchall()
    conn.executemany(
        "INSERT INTO jobs_fts (rowid, id, title, description, company, location, tags, matched_technologies, source, seniority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [tuple(row) for row in rows],
    )


def upsert_jobs(rows: Iterable[dict[str, Any]], db_path: str | Path | None = None) -> int:
    rows = list(rows)
    if not rows:
        return 0

    with connect(db_path) as conn:
        ensure_schema(conn)
        conn.executemany(UPSERT_SQL, [prepare_row(row) for row in rows])
        refresh_search_index(conn)
        conn.commit()
    return len(rows)


def load_jobs(db_path: str | Path | None = None) -> list[dict[str, Any]]:
    path = database_path(db_path)
    if not path.exists():
        return []

    with connect(path) as conn:
        ensure_schema(conn)
        cursor = conn.execute(SELECT_SQL)
        return [dict(row) for row in cursor.fetchall()]


def count_jobs(db_path: str | Path | None = None) -> int:
    path = database_path(db_path)
    if not path.exists():
        return 0
    with connect(path) as conn:
        ensure_schema(conn)
        cursor = conn.execute("SELECT COUNT(*) FROM jobs")
        value = cursor.fetchone()
        return int(value[0]) if value else 0


def search_jobs(
    query: str,
    db_path: str | Path | None = None,
    limit: int = 50,
    offset: int = 0,
    filters: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    path = database_path(db_path)
    if not path.exists():
        return []

    filters = filters or {}
    base_sql = SEARCH_SELECT_SQL
    clauses = []
    params: list[Any] = []

    if query.strip():
        clauses.append("jobs_fts MATCH ?")
        params.append(query)

    for field in SEARCH_FIELDS:
        value = clean_text(filters.get(field))
        if value and value != "all":
            clauses.append(f"j.{field} = ?")
            params.append(value)

    sql = base_sql
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY bm25(jobs_fts), COALESCE(j.posted_at, '') DESC, j.match_score DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    with connect(path) as conn:
        ensure_schema(conn)
        cursor = conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]


def count_search_jobs(
    query: str,
    db_path: str | Path | None = None,
    filters: dict[str, Any] | None = None,
) -> int:
    path = database_path(db_path)
    if not path.exists():
        return 0

    filters = filters or {}
    clauses = []
    params: list[Any] = []

    if query.strip():
        clauses.append("jobs_fts MATCH ?")
        params.append(query)

    for field in SEARCH_FIELDS:
        value = clean_text(filters.get(field))
        if value and value != "all":
            clauses.append(f"j.{field} = ?")
            params.append(value)

    sql = "SELECT COUNT(*) FROM jobs_fts f JOIN jobs j ON j.rowid = f.rowid"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)

    with connect(path) as conn:
        ensure_schema(conn)
        cursor = conn.execute(sql, params)
        value = cursor.fetchone()
        return int(value[0]) if value else 0


def sync_csv_to_db(csv_path: str | Path, db_path: str | Path | None = None) -> int:
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(path)

    rows: list[dict[str, Any]] = []
    for encoding in ("utf-8-sig", "utf-8", "cp1252"):
        try:
            with path.open("r", newline="", encoding=encoding) as handle:
                rows = list(csv.DictReader(handle))
            break
        except UnicodeDecodeError:
            continue
    else:
        raise UnicodeDecodeError("csv", b"", 0, 1, f"Unable to decode {path}")

    return upsert_jobs(rows, db_path=db_path)

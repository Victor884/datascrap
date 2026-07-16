from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from packages.jobstore import DEFAULT_DB_PATH, load_jobs

DEFAULT_OUTPUT = ROOT_DIR / "data" / "snapshots" / "jobs-snapshot.json"


def split_pipe_value(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if not text:
        return []
    return [part.strip() for part in text.split("|") if part.strip()]


def build_snapshot(jobs: list[dict[str, object]]) -> dict[str, object]:
    by_source = Counter(str(job.get("source") or "desconhecida") for job in jobs)
    by_location_mode = Counter(str(job.get("location_mode") or "other") for job in jobs)
    by_company = Counter(str(job.get("company") or "") for job in jobs if job.get("company"))
    by_seniority = Counter(str(job.get("seniority") or "") for job in jobs if job.get("seniority"))
    by_day = Counter(str(job.get("posted_at") or "")[:10] for job in jobs if job.get("posted_at"))
    by_tech = Counter(tech for job in jobs for tech in split_pipe_value(job.get("matched_technologies")))

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_jobs": len(jobs),
        "sources_active": len(by_source),
        "remote_brazil_jobs": by_location_mode.get("remote_brazil", 0),
        "brasilia_jobs": by_location_mode.get("brasilia", 0),
        "with_salary": sum(1 for job in jobs if job.get("salary_min") or job.get("salary_max")),
        "average_match": round(sum(len(split_pipe_value(job.get("matched_technologies"))) for job in jobs) / len(jobs), 2) if jobs else 0,
        "by_source": [{"name": name, "count": count} for name, count in by_source.most_common()],
        "by_location_mode": [{"name": name, "count": count} for name, count in by_location_mode.most_common()],
        "by_company": [{"name": name, "count": count} for name, count in by_company.most_common(10)],
        "by_seniority": [{"name": name, "count": count} for name, count in by_seniority.most_common()],
        "by_day": [{"date": day, "count": count} for day, count in sorted(by_day.items())],
        "by_technology": [{"name": name, "count": count} for name, count in by_tech.most_common(15)],
        "top_jobs": [
            {
                "id": job.get("id"),
                "title": job.get("title"),
                "company": job.get("company"),
                "location": job.get("location"),
                "match_score": job.get("match_score"),
                "source": job.get("source"),
            }
            for job in sorted(
                jobs,
                key=lambda item: (item.get("match_score") or 0, str(item.get("posted_at") or "")),
                reverse=True,
            )[:10]
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Gera um snapshot JSON com métricas agregadas da base relacional.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH), help="Caminho do banco SQLite.")
    parser.add_argument("--out", default=str(DEFAULT_OUTPUT), help="Arquivo JSON de saída.")
    args = parser.parse_args()

    jobs = load_jobs(args.db)
    payload = build_snapshot(jobs)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Pronto: snapshot gerado em {output} com {len(jobs)} vagas")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

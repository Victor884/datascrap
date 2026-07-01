import argparse
import csv
import re
import sys
import time
from pathlib import Path

from jobspy import scrape_jobs


DEFAULT_TERMS = [
    "engenheiro de dados junior",
    "analista de dados junior",
    "desenvolvedor python",
    "python data engineer",
    "junior data engineer",
    "junior data analyst",
    "pyspark",
    "apache spark",
    "databricks",
    "apache airflow",
    "sql",
]

DEFAULT_SITES = ["indeed", "linkedin", "google"]


def normalize(value):
    value = str(value or "").strip().lower()
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
        value = value.replace(original, replacement)
    return value


def is_remote(text):
    text = normalize(text)
    return any(term in text for term in ["remote", "remoto", "home office", "work from home"])


def is_brazil_or_latam(text):
    text = f" {normalize(text)} "
    return any(
        term in text
        for term in [
            " brasil ",
            " brazil ",
            " br ",
            " latam ",
            " latin america ",
            " america latina ",
        ]
    )


def is_brasilia(text):
    text = f" {normalize(text)} "
    return any(term in text for term in [" brasilia ", " distrito federal ", " df "])


def is_target_location(row):
    location = str(row.get("location", ""))
    description = str(row.get("description", ""))
    title = str(row.get("title", ""))
    is_remote_value = str(row.get("is_remote", "")).strip().lower()
    combined = " ".join([title, location, description])

    if is_brasilia(location):
        return True

    remote_flag = is_remote_value in ["true", "1", "yes", "sim"]
    remote_text = is_remote(combined)
    return (remote_flag or remote_text) and is_brazil_or_latam(combined)


def clean_text(value):
    value = "" if value is None else str(value)
    if value.strip().lower() == "nan":
        return ""
    return re.sub(r"\s+", " ", value).strip()


def row_value(row, *names):
    for name in names:
        if name in row and row[name] is not None:
            return row[name]
    return ""


def to_datascrap_row(row):
    min_amount = row_value(row, "min_amount", "salary_min")
    max_amount = row_value(row, "max_amount", "salary_max")
    currency = row_value(row, "currency", "salary_currency")
    interval = row_value(row, "interval", "salary_period")

    return {
        "source": clean_text(row_value(row, "site")),
        "title": clean_text(row_value(row, "title")),
        "company": clean_text(row_value(row, "company")),
        "company_logo": "",
        "location": clean_text(row_value(row, "location")),
        "url": clean_text(row_value(row, "job_url", "job_url_direct")),
        "tags": clean_text(row_value(row, "job_type")),
        "posted_at": clean_text(row_value(row, "date_posted")),
        "salary_min": clean_text(min_amount),
        "salary_max": clean_text(max_amount),
        "salary_currency": clean_text(currency),
        "salary_period": clean_text(interval),
    }


def scrape_term(term, sites, results_wanted, hours_old, verbose):
    google_search_term = f'{term} remoto Brasil OR LATAM OR Brasilia DF vagas'
    return scrape_jobs(
        site_name=sites,
        search_term=term,
        google_search_term=google_search_term,
        location="Brazil",
        results_wanted=results_wanted,
        hours_old=hours_old,
        country_indeed="Brazil",
        description_format="markdown",
        verbose=verbose,
    )


def main():
    parser = argparse.ArgumentParser(description="Busca vagas com JobSpy e exporta no schema do DataScrap.")
    parser.add_argument("--out", default="data/raw/vagas-jobspy.csv", help="Arquivo CSV de saida.")
    parser.add_argument("--results", type=int, default=20, help="Resultados por site e por termo.")
    parser.add_argument("--hours-old", type=int, default=168, help="Somente vagas publicadas nas ultimas N horas.")
    parser.add_argument("--sites", default=",".join(DEFAULT_SITES), help="Sites separados por virgula.")
    parser.add_argument("--terms", default=",".join(DEFAULT_TERMS), help="Termos separados por virgula.")
    parser.add_argument("--delay", type=float, default=2.0, help="Pausa entre termos, em segundos.")
    parser.add_argument("--verbose", type=int, default=1, choices=[0, 1, 2], help="Verbosity do JobSpy.")
    args = parser.parse_args()

    sites = [site.strip() for site in args.sites.split(",") if site.strip()]
    terms = [term.strip() for term in args.terms.split(",") if term.strip()]

    rows = []
    seen_urls = set()
    for term in terms:
        print(f"Buscando com JobSpy: {term}")
        try:
            jobs = scrape_term(term, sites, args.results, args.hours_old, args.verbose)
        except Exception as exc:
            print(f"[erro] {term}: {exc}", file=sys.stderr)
            continue

        for row in jobs.to_dict("records"):
            if not is_target_location(row):
                continue
            normalized = to_datascrap_row(row)
            url = normalized["url"].lower()
            dedupe_key = url or f'{normalized["source"]}|{normalized["title"]}|{normalized["company"]}'.lower()
            if dedupe_key in seen_urls:
                continue
            seen_urls.add(dedupe_key)
            rows.append(normalized)

        time.sleep(args.delay)

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "source",
        "title",
        "company",
        "company_logo",
        "location",
        "url",
        "tags",
        "posted_at",
        "salary_min",
        "salary_max",
        "salary_currency",
        "salary_period",
    ]
    with output.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames, quoting=csv.QUOTE_NONNUMERIC, escapechar="\\")
        writer.writeheader()
        writer.writerows(rows)

    print(f"Pronto: {len(rows)} vagas salvas em {output}")


if __name__ == "__main__":
    main()

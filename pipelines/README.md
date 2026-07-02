# Pipelines

Scripts e rotinas de ingestão, transformação e automação de dados.

## Disponíveis

- `jobspy_scraper.py`: coleta via JobSpy para `data/raw`
- `clean_jobs.py`: limpeza, deduplicação e padronização para `data/processed`
- `sync_jobs_db.py`: persistência da base processada em `data/warehouse/jobs.sqlite3`
- `build_snapshot.py`: snapshot JSON agregado em `data/snapshots/jobs-snapshot.json`

# Job Platform API

API Flask que consome os dados em `data/raw` e entrega filtros, métricas e listas de vagas.

## Rodar

```powershell
cd C:\Users\joao.vieira\Documents\scrap\apps\api
python -m flask --app app run --debug --port 5000
```

## Fonte de dados

- padrão: `data/raw/vagas*.csv`
- override: `JOBS_CSV_PATTERN`
- a API também lê `data/processed/vagas-processadas.csv` quando existir

## Endpoints

- `GET /api/health`
- `POST /api/reload`
- `GET /api/jobs`
- `GET /api/jobs/<id>`
- `GET /api/filters`
- `GET /api/insights`

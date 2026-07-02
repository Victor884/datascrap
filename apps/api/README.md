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
- se `data/warehouse/jobs.sqlite3` existir, o banco é priorizado
- `GET /api/storage` mostra a origem efetiva (database/csv/empty)
- `GET /api/snapshot` expõe o snapshot agregado usado pelo dashboard

## Container

```powershell
cd C:\Users\joao.vieira\Documents\scrap
copy .env.example .env
docker compose -f docker-compose.prod.yml up --build
```

A imagem da API copia `packages/` e `apps/api/` e lê o volume `./data` no runtime.


## Endpoints

- `GET /api/health`
- `POST /api/reload`
- `GET /api/jobs`
- `GET /api/jobs/<id>`
- `GET /api/filters`
- `GET /api/storage`
- `GET /api/search`
- `GET /api/snapshot`
- `GET /api/insights`

# Job Platform

Monorepo para coleta, processamento, armazenamento e visualização de vagas na área de Dados.

## Estrutura principal

```text
.
├── apps/
│   ├── api/          # backend/API em Python
│   ├── scraper-go/    # scraping principal em Go
│   └── web/           # frontend em Next.js
├── data/
│   ├── raw/           # dados brutos coletados
│   ├── processed/     # dados limpos e padronizados
│   └── warehouse/     # banco relacional local/artefatos SQLite
├── pipelines/         # rotinas de ingestão/transformação
├── packages/          # pacotes compartilhados
├── infra/             # infraestrutura e deploy
├── docs/              # documentação técnica
├── notebooks/         # análises exploratórias
├── scripts/           # utilitários e automações
└── tests/             # testes
```

## Ordem sugerida de evolução

1. Coleta de dados em Go.
2. Tratamento e padronização em Python.
3. Persistência em banco relacional.
4. Escalabilidade: índices, busca FTS, cache e snapshots.
5. API para consumo analítico.
6. Dashboard e métricas.
7. CI/CD e documentação.

## Como rodar

### API

```powershell
cd apps/api
python -m flask --app app run --debug --port 5000
```

### Frontend

```powershell
cd apps/web
npm install
npm run dev
```

- Next.js roda em http://127.0.0.1:3001
- usa `NEXT_PUBLIC_API_BASE` para apontar para a API

### Build do frontend

```powershell
cd apps/web
npm run build
```

### Deploy com Docker

```powershell
copy .env.example .env
docker compose -f docker-compose.prod.yml up --build
```

- API: http://127.0.0.1:5000
- Web: http://127.0.0.1:3001

### Scraper Go

```powershell
go run ./apps/scraper-go
```

### Limpeza e padronização

```powershell
python pipelines/clean_jobs.py --input-dir data/raw --out data/processed/vagas-processadas.csv
```

### Persistência em banco relacional

```powershell
python pipelines/sync_jobs_db.py --input data/processed/vagas-processadas.csv --db data/warehouse/jobs.sqlite3
```

## Configuração

Copie `.env.example` para `.env` antes de rodar os serviços.

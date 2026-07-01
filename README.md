# Job Platform

Monorepo para coleta, processamento, armazenamento e visualização de vagas na área de Dados.

## Estrutura principal

```text
.
├── apps/
│   ├── api/          # backend/API em Python
│   ├── scraper-go/    # scraping principal em Go
│   └── web/           # frontend em Next.js/Vite (base atual)
├── data/
│   ├── raw/           # dados brutos coletados
│   └── processed/     # dados limpos e padronizados
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
4. Pipelines automatizados.
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

### Scraper Go

```powershell
go run ./apps/scraper-go
```

### Limpeza e padronização

```powershell
python pipelines/clean_jobs.py --input-dir data/raw --out data/processed/vagas-processadas.csv
```

## Configuração

Copie `.env.example` para `.env` antes de rodar os serviços.

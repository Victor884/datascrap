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
- `GET /api/resumes`
- `POST /api/resumes` (`multipart/form-data`, campo `file`)
- `PUT /api/resumes/<id>/activate`
- `DELETE /api/resumes/<id>`

## Curriculos e match

- formatos aceitos: PDF, DOCX e TXT (ate 10 MB)
- os arquivos ficam em `data/profiles/resumes/`
- o perfil ativo fica registrado em `data/profiles/resumes.json`
- o texto extraido nao e devolvido pela API
- o score considera tecnologias em comum, termos do titulo, area da vaga e penalizacao por descricao ausente

## Coleta manual pelo dashboard

- `GET /api/scrape/status`: retorna o estado e os logs da coleta atual ou mais recente.
- `POST /api/scrape`: inicia o scraper Go em segundo plano.

Exemplo:

```json
{
  "sources": ["public", "linkedin", "indeed"],
  "query": "engenheiro de dados junior,analista de dados junior,desenvolvedor python",
  "force_refresh": false
}
```

A API aceita somente fontes conhecidas, impede execucoes simultaneas, grava a
saida em `data/raw/vagas-manual-*.csv`, sincroniza as vagas com o SQLite e
atualiza o snapshot ao concluir. Fontes indiretas continuam exigindo as chaves
documentadas no `.env`.

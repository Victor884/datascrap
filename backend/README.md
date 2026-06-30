# DataScrap API

API Flask para servir as vagas coletadas em CSV para o frontend.

## Rodar

```powershell
cd C:\Users\joao.vieira\Documents\scrap
.venv-jobspy\Scripts\python.exe -m flask --app backend.app run --debug --port 5000
```

## Endpoints

- `GET /api/health`
- `GET /api/jobs`
- `GET /api/jobs/<id>`
- `GET /api/filters`
- `GET /api/insights`

## Filtros principais

```text
/api/jobs?q=python&source=indeed&location_mode=remote_brazil&tech=sql&limit=20&offset=0
```

`location_mode` aceita:

- `remote_brazil`
- `brasilia`
- `all`

Por padrao, a API le arquivos `vagas*.csv` na raiz do projeto. Para mudar:

```powershell
$env:JOBS_CSV_PATTERN="vagas-jobspy.csv"
```

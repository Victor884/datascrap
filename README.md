# DataScrap

CLI em Go para coletar vagas da area de dados em fontes publicas e exportar os resultados para CSV ou JSON.

## Fontes atuais

- RemoteOK
- Arbeitnow
- Remotive
- Jobicy
- The Muse
- Adzuna, opcional com chave de API
- LinkedIn, Gupy e Indeed via SerpAPI, opcional com chave de API

O projeto usa apenas a biblioteca padrao do Go. Isso evita dependencias extras e deixa o scraper facil de rodar em qualquer maquina com Go instalado.

## Como rodar

Instale o Go e execute:

```powershell
go run ./cmd/datascrap
```

Isso cria o arquivo `vagas-dados.csv`.

Para salvar JSON:

```powershell
go run ./cmd/datascrap -format json -out vagas-dados.json
```

Para ajustar as palavras-chave:

```powershell
go run ./cmd/datascrap -query "engenheiro de dados junior,analista de dados junior,desenvolvedor python" -out vagas.csv
```

## Ativar Adzuna

A Adzuna ajuda a buscar vagas no Brasil, mas exige credenciais gratuitas da API.

No PowerShell:

```powershell
$env:ADZUNA_APP_ID="seu_app_id"
$env:ADZUNA_APP_KEY="sua_app_key"
go run ./cmd/datascrap
```

Sem essas variaveis, o scraper pula a Adzuna e usa as outras fontes normalmente.

## Fontes recomendadas para comecar

Para rodar sem chaves e com menos atrito, use a combinacao:

- Remotive
- Jobicy
- Arbeitnow

Elas retornam JSON e funcionam bem para um projeto de portfolio em dados/BI. A Jobicy tambem pede credito/link direto para a vaga original, por isso o CSV preserva a URL da vaga. Quando disponiveis, os campos da Jobicy tambem alimentam `company_logo`, `salary_min`, `salary_max`, `salary_currency` e `salary_period`.

## Ativar LinkedIn, Gupy e Indeed

O scraper nao usa proxy rotativo, stealth browser ou servico de CAPTCHA. Para consultar LinkedIn, Gupy e Indeed sem automatizar navegador nem tentar burlar bloqueios, use uma API de busca.

Com SerpAPI:

```powershell
$env:SERPAPI_KEY="sua_serpapi_key"
go run ./cmd/datascrap
```

Essa fonte pesquisa resultados desses sites e ainda aplica os filtros locais:

- Remotas aceitando Brasil, Brazil, BR ou LATAM.
- Hibridas ou presenciais somente em Brasilia/DF.
- Cargos de engenheiro de dados junior, analista de dados junior e desenvolvedor Python.

## JobSpy opcional

Tambem ha um scraper opcional em Python usando JobSpy para consultar fontes como Indeed, LinkedIn e Google Jobs.

Criar ambiente local com Python 3.12 usando `uv`:

```powershell
uv venv .venv-jobspy --python 3.12
uv pip install --python .venv-jobspy\Scripts\python.exe -r requirements-jobspy.txt
```

Rodar uma busca pequena:

```powershell
.venv-jobspy\Scripts\python.exe scripts\jobspy_scraper.py --sites indeed,linkedin,google --terms "python,sql,pyspark" --results 10 --out vagas-jobspy.csv
```

O script aplica os mesmos filtros locais:

- Remotas aceitando Brasil/Brazil/BR/LATAM.
- Hibridas ou presenciais somente em Brasilia/DF.

Ele nao configura proxies, user-agents customizados, stealth browser ou CAPTCHA solver.

## API Flask

O projeto tambem tem uma API Flask para conectar o backend de CSVs com o frontend.

Instalar Flask na venv:

```powershell
uv pip install --python .venv-jobspy\Scripts\python.exe -r requirements-api.txt
```

Rodar a API:

```powershell
.venv-jobspy\Scripts\python.exe -m flask --app backend.app run --debug --port 5000
```

Endpoints principais:

- `GET http://127.0.0.1:5000/api/health`
- `GET http://127.0.0.1:5000/api/jobs`
- `GET http://127.0.0.1:5000/api/filters`
- `GET http://127.0.0.1:5000/api/insights`

## Proximos passos bons

- Adicionar fontes brasileiras, como Programathor, Gupy ou LinkedIn, quando voce definir quais sites quer monitorar.
- Persistir historico em SQLite para acompanhar vagas novas por dia.
- Criar filtros por senioridade, remoto/hibrido/presencial e localidade.
- Agendar execucao diaria com Task Scheduler no Windows.

## Observacao

Antes de raspar HTML de qualquer site, confira os termos de uso e o `robots.txt`. Sempre prefira APIs publicas quando existirem.

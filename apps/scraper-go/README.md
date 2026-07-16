# Go Scraper

Coletor principal do DataScrap. O comando usa APIs publicas quando disponiveis e
pesquisa via SerpAPI para fontes que nao oferecem uma API publica de vagas.

## Fontes

- Publicas, sem credenciais: `remoteok`, `arbeitnow`, `remotive`, `jobicy`, `themuse`.
- Com credenciais proprias: `adzuna`.
- Via SerpAPI: `linkedin`, `indeed`, `glassdoor`, `gupy`, `infojobs`.

## Rodar

Na raiz do projeto:

```powershell
go run ./apps/scraper-go -sources public
```

Para selecionar fontes especificas:

```powershell
go run ./apps/scraper-go `
  -sources "jobicy,remotive,linkedin,indeed,glassdoor,infojobs" `
  -query "engenheiro de dados junior,analista de dados junior,desenvolvedor python" `
  -out "data/raw/vagas-coleta.csv" `
  -timeout 3m
```

Para LinkedIn, Indeed, Glassdoor, Gupy e InfoJobs, crie um `.env` na raiz:

```dotenv
SERPAPI_KEY=sua_chave
```

O CSV gerado segue o schema consumido pela API Flask. Depois da coleta,
recarregue a API com `POST /api/reload` ou reinicie o servidor.

## Comportamento HTTP

O coletor possui uma camada gratuita de resiliencia que:

- identifica-se de forma transparente como `DataScrap`;
- limita requisicoes por dominio e adiciona jitter para distribuir a carga;
- respeita `Retry-After` e usa backoff exponencial em `429`, timeout e `5xx`;
- abre um circuit breaker apos bloqueios repetidos, evitando insistencia;
- mantem cache HTTP local por 6 horas para nao repetir buscas iguais;
- interrompe preventivamente qualquer acesso HTTP direto ao LinkedIn;
- mostra contadores de requisicoes, cache, retries e bloqueios ao terminar.

As opcoes podem ser ajustadas sem alterar o codigo:

```powershell
go run ./apps/scraper-go `
  -sources "public,linkedin" `
  -min-interval 2s `
  -retries 3 `
  -cache-ttl 12h `
  -cache-dir "data/cache/http" `
  -timeout 3m
```

Use `-cache-ttl 0` apenas para diagnostico. Em execucoes normais, manter o cache
reduz consumo das cotas gratuitas e a carga nas fontes.

## LinkedIn

O nome de fonte `linkedin` consulta resultados indexados por meio da SerpAPI e
nao acessa paginas do LinkedIn. Isso exige `SERPAPI_KEY` e fica sujeito a cota e
termos do provedor. O LinkedIn proibe scraping automatizado sem permissao
expressa; por isso o projeto nao falsifica navegador, nao gira User-Agent, nao
usa cookies de conta, proxies, CAPTCHA solvers nem tecnicas de stealth.

Para coletar diretamente do LinkedIn, solicite permissao pelo canal oficial de
crawling e use somente os caminhos, IP e User-Agent aprovados. Sem essa
permissao, mantenha a fonte indireta ou use os alertas de vagas do LinkedIn
manualmente.

## Agendamento recomendado

Para um projeto pessoal, rode a coleta completa uma ou duas vezes por dia. O
cache evita repeticao dentro da janela configurada; a deduplicacao do CSV evita
vagas repetidas no resultado. Evite loops continuos e nao execute varias
instancias do coletor ao mesmo tempo.

# Contrato de dados

## Camada raw

Os scrapers gravam CSVs em `data/raw/`.

Campos esperados na saída bruta:

- `source`
- `title`
- `company`
- `company_logo`
- `location`
- `url`
- `tags`
- `posted_at`
- `salary_min`
- `salary_max`
- `salary_currency`
- `salary_period`

## Camada processed

O pipeline de limpeza gera `data/processed/vagas-processadas.csv` com o schema canônico:

- `id`
- `source`
- `source_file`
- `title`
- `company`
- `company_logo`
- `location`
- `location_mode`
- `is_remote`
- `url`
- `tags`
- `posted_at`
- `salary_min`
- `salary_max`
- `salary_currency`
- `salary_period`
- `matched_technologies`
- `match_score`
- `seniority`
- `cleaned_at`

## Regras de normalização

- texto é aparado e colapsado
- valores `nan` vazios são tratados como nulos
- datas são convertidas para ISO 8601 quando possível
- salários são convertidos para número quando possível
- tecnologias relevantes são marcadas com base no texto da vaga
- vagas duplicadas são removidas pelo link da vaga ou por um identificador estável

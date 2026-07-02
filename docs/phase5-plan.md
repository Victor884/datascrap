# Phase 5 Plan — Frontend, Product Polish e Deploy

Este plano assume que as fases 1–4 já estão prontas:
- coleta em Go
- limpeza/normalização em Python
- persistência em SQLite
- índices, busca FTS, cache e snapshots

A fase 5 fecha o produto como portfólio: transforma a API e os dados em uma experiência de uso bonita, rápida e fácil de demonstrar.

## Objetivo da fase 5

Entregar um frontend moderno de vagas com:
- busca rápida
- filtros úteis
- cards e tabela legíveis
- página de detalhes de vaga
- visão analítica com gráficos e snapshot
- experiência responsiva
- deploy simples e reproduzível

## Stack recomendada

- **Frontend:** Next.js + TypeScript + Tailwind CSS
- **Data fetching:** TanStack Query ou fetch hooks bem isolados
- **Charts:** Recharts ou ECharts
- **UI primitives:** componentes próprios simples, sem depender de um design system pesado
- **Deploy:** Vercel para frontend e Render/Fly.io/railway para API, ou Docker Compose para ambiente único

Se você quiser reduzir escopo, mantenha Next sem TypeScript no primeiro corte e migre os tipos depois. Mas, como plano ideal, Next.js + TypeScript + Tailwind é a melhor versão final.

## Ordem completa de execução

### 1. Definir a experiência do usuário

Antes de codar, responda estas perguntas:
- qual é a tela principal?
- o usuário quer ver vagas ou insights primeiro?
- quais filtros são essenciais?
- o que deve aparecer em um card de vaga?
- qual métrica faz mais sentido no topo?

**Decisão sugerida:**
- landing do produto = dashboard de vagas
- insights em uma aba separada
- detalhe da vaga em drawer lateral ou página dedicada

**Entregável:** um wireframe simples com 3 áreas:
- topo com KPIs
- coluna lateral de filtros
- área central com lista + visualização detalhada

### 2. Migrar o frontend para uma base final

Se a meta é portfólio, faça a migração para uma stack mais profissional.

**Tarefas:**
- criar `apps/web-next/` ou converter `apps/web/` para Next.js
- adicionar TypeScript
- adicionar Tailwind
- organizar `src/components`, `src/features`, `src/lib`, `src/hooks`
- criar layout base com header, sidebar e main content

**Arquivos esperados:**
- `apps/web/package.json`
- `apps/web/next.config.*` ou equivalente
- `apps/web/tailwind.config.*`
- `apps/web/src/app/*` ou `src/pages/*`
- `apps/web/src/components/*`
- `apps/web/src/lib/api.ts`

**Critério de pronto:**
- aplicativo sobe localmente
- layout base renderiza sem erro
- consumo da API centralizado em um helper

### 3. Centralizar a camada de dados do frontend

A UI não deve chamar `fetch` espalhado em vários componentes.

**Tarefas:**
- criar um cliente HTTP único
- mapear os endpoints da API:
  - `GET /api/jobs`
  - `GET /api/search`
  - `GET /api/filters`
  - `GET /api/insights`
  - `GET /api/storage`
  - `GET /api/snapshot`
- padronizar tratamento de erro e loading
- criar tipagens para Job, Insight e Snapshot

**Critério de pronto:**
- uma única camada conhece a URL da API
- os componentes recebem dados tipados
- erro offline é mostrado de forma amigável

### 4. Construir o dashboard principal

Essa é a tela mais importante do produto.

**Componentes sugeridos:**
- KPI cards: total de vagas, fontes ativas, remoto BR, vagas com salário
- gráfico de vagas por dia
- gráfico por tecnologia
- gráfico por senioridade
- barra de busca e filtros rápidos
- lista paginada ou infinita de vagas

**Tarefas:**
- melhorar a tabela/cartões atuais
- destacar salário, local, senioridade e fonte
- adicionar badges para tecnologias
- adicionar botão para abrir o detalhe da vaga
- garantir responsividade mínima

**Critério de pronto:**
- alguém abre o app e entende o valor em menos de 10 segundos
- a UI não depende de conhecimento técnico para ser compreendida

### 5. Criar página ou drawer de detalhe da vaga

A experiência de detalhe é o que eleva o projeto acima de um scraper simples.

**Tarefas:**
- mostrar título, empresa, local, salário, fonte, tags e tecnologias
- incluir link externo da vaga
- exibir match score e justificativa do match
- mostrar data de publicação
- oferecer botão de copiar URL

**Critério de pronto:**
- o usuário consegue avaliar uma vaga sem sair da plataforma

### 6. Usar a fase 4 para acelerar a fase 5

Como a fase 4 já trouxe cache, FTS e snapshot, agora a UI deve aproveitar isso.

**Tarefas:**
- usar `/api/search` na busca global
- usar `/api/snapshot` para métricas e top jobs
- usar `/api/storage` para status e origem dos dados
- aproveitar paginação server-side sempre que possível

**Critério de pronto:**
- busca rápida mesmo com base maior
- menos processamento pesado no browser

### 7. Refinar UX/UI

**Tarefas práticas:**
- estados de loading com skeleton
- estados vazios com mensagem útil
- mensagens de erro claras
- modo compacto para listas grandes
- botões e filtros com consistência visual
- acessibilidade básica: contraste, foco, teclado

**Critério de pronto:**
- app parece produto final, não protótipo

### 8. Adicionar testes e validações

Não precisa virar uma suíte enorme, mas precisa existir cobertura mínima.

**Tarefas:**
- testes de componentes críticos
- teste de integração da camada de API no frontend
- smoke test do build do frontend
- verificação da API com payload real

**Sugestão de comando final:**
- frontend: `npm run build`
- backend: `python -m py_compile ...`
- pipeline: rodar os scripts de snapshot/sync em dados de exemplo

**Critério de pronto:**
- build passa
- páginas principais renderizam
- API continua estável

### 9. Preparar deploy

**Tarefas:**
- adicionar Dockerfiles se ainda não existirem para cada app
- revisar variáveis de ambiente
- documentar como apontar o frontend para a API
- publicar frontend e API em ambientes separados ou com proxy reverso

**Critério de pronto:**
- qualquer pessoa consegue subir o projeto localmente
- o deploy não depende de passos manuais escondidos

### 10. Fechar com documentação de portfólio

**Tarefas:**
- atualizar README raiz com prints ou GIFs
- descrever arquitetura final
- listar fases concluídas
- explicar decisões técnicas
- adicionar roadmap futuro curto

**Critério de pronto:**
- o GitHub explica o projeto sozinho
- a página principal do repo mostra valor de produto

## Sequência recomendada de implementação

Se você for executar sozinho, faça nesta ordem:
1. definir wireframe
2. migrar a base do frontend
3. centralizar client/API e tipagens
4. construir dashboard principal
5. implementar detalhe da vaga
6. conectar `/api/search` e `/api/snapshot`
7. polir UX
8. validar build e smoke tests
9. preparar deploy
10. atualizar documentação final

## Estrutura final esperada

```text
apps/
  api/
  scraper-go/
  web/
pipelines/
packages/
data/
  raw/
  processed/
  warehouse/
  snapshots/
docs/
  data-contract.md
  phase5-plan.md
infra/
```

## O que evitar na fase 5

- não misturar scraping com UI
- não colocar lógica de negócio nos componentes
- não chamar a API em todo componente separadamente
- não criar visual pesado sem valor analítico
- não começar por deploy antes de o dashboard funcionar

## Resultado final esperado

Ao fim da fase 5, o projeto deve parecer um produto real:
- dados entram por automação
- passam por limpeza e persistência
- são expostos por API e snapshots
- são consumidos por uma interface moderna
- a apresentação no GitHub fica forte como portfólio

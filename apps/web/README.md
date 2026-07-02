# Frontend

Dashboard web do projeto em migração para Next.js.

- stack alvo: Next.js + React + TypeScript + Tailwind
- estado atual: Next.js com o dashboard já portado para app router
- dados consumidos: `/api/jobs`, `/api/insights`, `/api/filters`, `/api/storage`, `/api/snapshot`

## Rodar em desenvolvimento

```powershell
cd C:\Users\joao.vieira\Documents\scrap\apps\web
npm install
npm run dev
```

O app sobe em `http://127.0.0.1:3001`.

## Build de produção

```powershell
cd C:\Users\joao.vieira\Documents\scrap\apps\web
npm run build
```

## Container

```powershell
cd C:\Users\joao.vieira\Documents\scrap
docker compose -f docker-compose.prod.yml up --build
```

O frontend usa `NEXT_PUBLIC_API_BASE` para apontar para a API Flask.

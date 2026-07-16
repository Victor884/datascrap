# Infra

Arquivos de empacotamento e deploy da fase 5.

- `docker-compose.prod.yml`: sobe API Flask + frontend Nginx com a pasta `data/` montada
- `apps/api/Dockerfile`: imagem Python para a API e os pipelines compartilhados
- `apps/web/Dockerfile`: build Next e servidor Node em produção
- `apps/web/nginx.conf`: legado do Vite, não usado no fluxo novo

Para subir localmente:

```powershell
copy .env.example .env
docker compose -f docker-compose.prod.yml up --build
```

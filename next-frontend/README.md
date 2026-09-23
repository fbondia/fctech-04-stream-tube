# StreamTube frontend

O frontend Next.js roda na porta **3001 do host** via Docker Compose. A porta **3000 do host** pertence à API NestJS. Consulte o [README do projeto](../README.md) para subir o backend e aplicar as migrations antes de iniciar o frontend.

```bash
cd next-frontend
printf 'API_URL=http://host.docker.internal:3000\nSESSION_PASSWORD=%s\n' "$(openssl rand -hex 32)" > .env.local
docker compose up -d
docker compose exec next-frontend npm install # apenas na primeira vez
docker compose exec -d next-frontend npm run dev
```

Abra [http://localhost:3001](http://localhost:3001). A rota inicial abre a tela de login para visitantes e uma página inicial simples após o login; as telas de cadastro e recuperação de senha também estão disponíveis. A interface de vídeos ainda não foi implementada. O arquivo `.env.local` é ignorado pelo Git. `API_URL` é o endereço do backend visto de dentro do container; `SESSION_PASSWORD` deve ser uma chave exclusiva de pelo menos 32 caracteres para os cookies de sessão. Se rodar `npm run dev` diretamente no host, use `API_URL=http://localhost:3000`.

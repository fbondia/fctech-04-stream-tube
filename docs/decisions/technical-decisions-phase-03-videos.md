---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-09-23
scope_description: "Backend, worker e infraestrutura para upload de até 10 GB, processamento assíncrono, URL única, streaming e download de vídeos."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API, persistência, storage, fila, worker, testes e Compose.
- `next-frontend/` — a interface está fora do escopo da fase. O protocolo de upload e a URL de leitura são contratos para um cliente futuro ou HTTP de teste; esta pesquisa não implementa frontend.

**Fontes e precedência.** O anexo BIAWS `desafio04.html` da melhoria `desafio-04` é canônico. Sua cópia em `../índice/desafio04.html` tem SHA-256 `398218579b2dcb3eb69c97daa67efb5984ffd1d5a53e17975cbe51544b396e64`, igual ao checksum informado pelo BIAWS. As notas da melhoria de 2026-09-23 esclarecem que presign/multipart, Range/206 e slug eram alternativas a pesquisar; o requisito é upload funcional de até 10 GB sem bloquear a API, URL única e streaming sem download completo. F03-06 persiste a intenção durável; F03-07 é a única responsável por publicá-la na fila e consumir o job. O [plano geral](../project-plan.md) acrescenta retomada de upload após falha de conexão. O [diagrama](../diagrams/software-arch.mermaid) mostra a arquitetura-alvo, não serviços já instalados.

**Baseline.** `package-lock.json` fixa `@nestjs/core` 11.1.16, `@nestjs/config` 4.0.3, `@nestjs/typeorm` 11.0.1 e `typeorm` 0.3.28; Node da imagem de desenvolvimento é 25.6.0 e Compose usa PostgreSQL 17. Não há SDK S3, BullMQ ou Redis no projeto. O backend já usa JWT guard global com `@Public()`, entidades relacionadas ao canal, migrations, `@nestjs/config`/Joi e filtros de erro de domínio. As versões exatas das novas bibliotecas e imagens serão fixadas e testadas no lockfile/Compose da F03-03/F03-04; esta tarefa não adiciona dependências. Documentação consultada em 2026-09-23, nas versões indicadas abaixo.

---

## TD-01: Tecnologia de fila e operação do worker

**Scope:** Backend / Repo-wide

**Capability:** Serviço de processamento em segundo plano (filas); processamento automático do vídeo após upload.

**Context:** A API não pode executar FFmpeg nem depender da execução do job para responder à confirmação. O Compose precisa iniciar uma fila e um worker reais.

| Opção | Vantagens | Custos e riscos |
| --- | --- | --- |
| A. BullMQ + Redis, integração `@nestjs/bullmq` | Integração oficial com NestJS; jobs persistidos, retries/backoff, concorrência, eventos e IDs próprios; um Redis no Compose. | Redis exige volume, política de persistência e monitoramento; entrega pode repetir; um job removido deixa de deduplicar por `jobId`. |
| B. RabbitMQ com fila durável | Confirmações do publisher e acknowledgements do consumidor; quorum queues têm garantias fortes em cluster. | Mais topologia/operacionalização para este único fluxo; retry, atraso e idempotência exigem desenho adicional. Em Compose de um nó não há benefício de quorum. |
| C. Tabela PostgreSQL como única fila | Reaproveita banco e transações, sem broker novo. | Não atende a exigência explícita de fila real no Compose; polling/concorrência e observabilidade virariam implementação própria. |

**Recommendation / Decision:** **A — BullMQ + Redis**, com `@nestjs/bullmq` da linha 11 compatível com NestJS 11 e BullMQ da linha suportada pela versão escolhida, a confirmar no lockfile na F03-03. Redis deve ter volume persistente e AOF habilitado; `appendfsync everysec` pode perder aproximadamente o último segundo de escrita em falha brusca, portanto o PostgreSQL (TD-06) é a fonte de recuperação. Worker roda em container/processo Nest separado, sem registrar o consumer no processo da API. O worker chama `ffprobe`/FFmpeg por subprocessos com limites explícitos, sem execução síncrona de mídia na API. Configurar concorrência pequena e ajustável, tentativas finitas, backoff exponencial com jitter quando suportado, retenção limitada de jobs concluídos/falhos e métricas/logs de espera, tentativa e resultado. Falha terminal marca `error`; não deixar poison job em repetição infinita. A F03-03 fixa valores e critérios de alerta.

**Consequences:** Há dois estados persistentes (PostgreSQL e Redis), então publicar na fila não substitui a intenção transacional no banco. O processamento é **pelo menos uma vez**, nunca presumidamente exatamente uma vez. `jobId` ajuda a evitar duplicação enquanto o job existe, mas a idempotência definitiva fica no banco e no worker. [NestJS queues](https://docs.nestjs.com/application/queues), [BullMQ retries](https://docs.bullmq.io/guide/retrying-failing-jobs), [stalled jobs](https://docs.bullmq.io/guide/jobs/stalled), [job IDs e remoção](https://docs.bullmq.io/guide/jobs/job-ids), [Redis AOF](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/), [RabbitMQ quorum queues](https://www.rabbitmq.com/docs/quorum-queues).

## TD-02: Protocolo de upload até 10 GB

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance; pré-cadastro automático do vídeo como rascunho ao iniciar o upload.

**Context:** O HTML exige que a API não segure a transferência de 10 GB. O plano geral exige retomada após interrupção. O frontend de vídeo será posterior, mas o protocolo precisa ser exercitável agora por cliente HTTP.

| Opção | Vantagens | Custos e riscos |
| --- | --- | --- |
| A. Multipart S3 direto, `UploadPart` com URL assinada por parte | Dados vão do cliente ao storage; partes retransmitidas isoladamente; paralelismo limitado; atende 10 GB e retomada. | Contrato de início, assinatura de partes, conclusão e cancelamento; CORS, ETags e limpeza de uploads incompletos. |
| B. `PUT` único por URL assinada | Handshake menor; API fora do caminho de dados. | Falha perto de 10 GB reinicia todo o envio; retomada não é adequada. |
| C. Multipart/form-data ou stream pelo Nest | Cliente simples e controle central. | Conexões longas e tráfego integral pela API; descumpre a separação pretendida e amplia custo de escala. |

**Recommendation / Decision:** **A — multipart S3 direto ao MinIO/S3.** Ao iniciar, a API autentica o dono do canal, valida metadados declarados e tamanho `1..10_000_000_000` bytes (10 GB decimais), cria vídeo `draft`, gera key exclusiva e inicia multipart com o SDK S3. O cliente solicita URLs assinadas para partes numeradas, envia os bytes diretamente ao endpoint público alcançável do storage, guarda `partNumber`/`ETag` e pode pedir novas URLs para retomar. A API limita números/quantidade de partes e expiração; o cliente pode consultar partes já recebidas pelo protocolo definido na F03-03. **Só a API** chama `CompleteMultipartUpload` depois de validar ownership, uploadId/key e confrontar a lista de partes do cliente com `ListParts` paginado, inclusive soma dos tamanhos reais e ordem. Essa checagem ocorre antes da conclusão para recusar um arquivo acima de 10 GB; após concluir, `HeadObject` confirma tamanho, metadados esperados e existência. A confirmação grava intenção durável uma única vez (TD-06). Se a verificação falhar, não enfileira; objeto incorreto é removido/quarentenado e o registro recebe erro recuperável conforme contrato da F03-03. API oferece cancelamento, aborta multipart expirado e reconcilia drafts órfãos. URL assinada dá acesso temporário ao objeto/parte específico; não é um token de autorização geral.

**Limites:** S3 permite no máximo 10.000 partes, cada uma de 5 MiB a 5 GiB, exceto a última. Para 10 GB, 16 MiB por parte implica até 597 partes; a F03-03 fixa tamanho e concorrência e testa o limite sem fixture de 10 GB. A assinatura deve usar o **hostname que o cliente realmente acessa**; reescrever host/porta em URL já assinada quebra a assinatura. A API e o browser poderão usar endpoints distintos para o mesmo MinIO, desde que a assinatura seja gerada para o endpoint externo e a API use o endereço interno. CORS deve permitir somente origens/métodos/headers necessários e expor `ETag`. ETag multipart **não é hash MD5 do arquivo completo**; verificação forte de integridade, se exigida, deve usar checksums S3 compatíveis e teste MinIO/S3. Validação inicial de MIME/extensão é preliminar; `ffprobe` valida o conteúdo real antes de `ready`.

**Consequences:** O cliente implementa divisão, retentativa e preservação do `uploadId`; a API recebe metadados e respostas pequenas, nunca os bytes do vídeo. Requer bucket privado, ciclo de limpeza de partes e teste de compatibilidade dos comandos/checksums no MinIO escolhido. [S3 multipart overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html), [multipart limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html), [presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), [SDK JS v3 S3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html), [MinIO S3 API](https://docs.min.io/aistor/reference/aistor-server/http-endpoints/), [MinIO CORS](https://docs.min.io/aistor/administration/cors-configuration/), [S3 ETag/checksums](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html).

## TD-03: Organização e proteção dos objetos

**Scope:** Backend / Repo-wide

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails); geração automática de thumbnail.

**Context:** MinIO local e S3 em produção são requisitos. Chaves devem ser imutáveis, não adivinhadas a partir de título e vinculadas a um único vídeo/canal.

| Opção | Vantagens | Custos e riscos |
| --- | --- | --- |
| A. Buckets privados separados para originais e thumbnails, keys por canal/vídeo | Políticas/lifecycle distintos; isolamento lógico; fácil auditar. | Dois buckets e configuração adicional. |
| B. Bucket privado único com prefixos | Provisionamento simples. | Políticas e retenção de objetos de tamanhos muito diferentes ficam acopladas. |
| C. Buckets públicos | Entrega direta simples. | Contorna autorização e expõe rascunhos; inadequado. |

**Recommendation / Decision:** **A.** Buckets privados `videos-originals` e `videos-thumbnails` (nomes parametrizáveis). Keys geradas no servidor, por exemplo `channels/{channelId}/videos/{videoId}/original/{opaqueName}` e `channels/{channelId}/videos/{videoId}/thumbnails/{generation}.jpg`; `channelId` e `videoId` são IDs internos, sem nome de usuário/título. DB guarda bucket/key, não URL assinada. Sem ACL pública; credenciais da API limitadas a iniciar/confirmar/cancelar e ler metadados; worker pode ler original e escrever thumbnail; leitura pública passa pela política de TD-05. Reinício do Compose cria buckets idempotentemente; versões de imagem e política são fixadas na F03-04. Lifecycle aborta multipart incompleto; exclusão de vídeo e retenção futura devem eliminar objetos correspondentes. Não prometer isolamento de segurança apenas pelo prefixo: políticas de IAM/usuário e ownership no banco também são necessários.

**Consequences:** Configuração tipada para endpoint interno/externo, região, path-style, buckets e credenciais; testes reais contra MinIO. [MinIO S3 API](https://docs.min.io/aistor/reference/aistor-server/http-endpoints/), [S3 multipart cleanup](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html).

## TD-04: Processamento, thumbnail e recursos do worker

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados); geração automática de thumbnail a partir de um frame.

**Context:** Vídeos podem ter 10 GB; não podem ser carregados integralmente em memória. O processo pode falhar ou ser entregue novamente.

| Opção | Vantagens | Custos e riscos |
| --- | --- | --- |
| A. Worker separado baixa em stream para arquivo temporário, usa `ffprobe` e FFmpeg | Ferramentas estáveis; seek local para formatos variados; consumo de memória limitado. | Precisa de espaço temporário por job, limite de concorrência e limpeza. |
| B. FFmpeg lendo URL de storage diretamente | Evita cópia local se seek remoto funcionar. | Credenciais/URLs efêmeras no subprocesso; comportamento de seek e acesso varia; pior controle de falhas. |
| C. Biblioteca JS de parsing/frame | Menos binários externos. | Cobertura de contêineres/codecs e extração de frame insuficiente frente ao requisito. |

**Recommendation / Decision:** **A.** O worker em container próprio obtém o original por stream para diretório temporário com limite de disco proporcional à concorrência e 10 GB por job, executa `ffprobe` com saída JSON controlada, valida presença de vídeo, duração finita e codec/contêiner permitidos, escolhe um frame dentro da duração e gera JPEG por FFmpeg. Sobe thumbnail sob key determinística da geração e só então persiste metadados/thumbnail e faz `ready` com transição condicional. Sempre remove temporários e encerra subprocessos em timeout/cancelamento. Separar falha de entrada inválida (terminal) de falha transitória de storage/fila (retry); erro e logs são sanitizados. Definir versão de imagem FFmpeg na F03-04 e testar com fixture real pequena.

**Consequences:** O worker precisa de volume/disco temporário e limite de concorrência baseado em capacidade, não só no número de CPUs. A API não instala nem executa FFmpeg. [ffprobe](https://ffmpeg.org/ffprobe.html), [FFmpeg](https://ffmpeg.org/ffmpeg.html), [BullMQ stalled](https://docs.bullmq.io/guide/jobs/stalled).

## TD-05: URL única, leitura parcial e download

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos; reprodução via streaming sem necessidade de download completo; download do vídeo pelo usuário.

**Context:** O identificador público deve ser estável, curto e independente de título mutável. O storage é privado. O player precisa pedir apenas os bytes necessários, com autorização coerente.

| Decisão | Opção | Vantagens | Custos e riscos |
| --- | --- | --- | --- |
| Identificador | Slug do título | URL legível. | Mudança de título, normalização/idiomas e colisões exigem redirects e regras adicionais. |
| Identificador | UUID v4 | Nativo no banco e sem colisão prática. | URL de 36 caracteres, sem benefício de legibilidade. |
| Identificador | Token aleatório opaco | URL curta, imutável e desacoplada do título. | Precisa de índice único e retry da colisão teórica; não é autorização. |
| Entrega | Redirect para GET pré-assinado | Storage entrega bytes diretamente, reduz banda na API. | URL temporária funciona como bearer token; autorização e revogação por request são menos diretas. |
| Entrega | Proxy de stream pela API | Checagem de estado/permissão a cada request e URL estável; oculta key/endpoint interno. | API sustenta tráfego e conexões; requer backpressure e cancelamento. |
| Entrega | Bucket público | Integração simples com player. | Expõe objetos sem controle por vídeo/estado e viola o isolamento dos rascunhos. |

**Recommendation / Decision:** **Token aleatório opaco de 128 bits, base64url (22 caracteres)**, gerado com `crypto.randomBytes`, índice `UNIQUE` no PostgreSQL e retry em colisão. Para a entrega, **proxy em stream pela API com `Range` passado ao S3**, após checar estado/permissão. As duas escolhas mantêm URL única e estável sem tornar o identificador um segredo de autorização.

**Contrato estratégico:** A API oferece leitura por identificador opaco apenas no estado `ready` e segundo a matriz de autorização definida na F03-03. Para um único range de bytes válido, responde `206`, `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`, `Content-Type` e repassa só o trecho solicitado via `GetObject(Range=...)`; sem Range, pode transmitir o objeto em stream (`200`) sem armazená-lo em memória. Para range insatisfazível retorna `416` com `Content-Range: bytes */{size}`. A F03-03 fixa política para múltiplos ranges, `HEAD` e `If-Range`, com testes de começo, meio, sufixo, inválido e cancelamento. Download reaproveita a leitura em stream e acrescenta `Content-Disposition: attachment` com filename sanitizado. Thumbnail segue a mesma autorização, via proxy ou resposta pequena em stream; nenhuma key interna em resposta pública. Não aplicar `@Public()` a operações do dono; endpoints de reprodução pública, se adotados, fazem a checagem de visibilidade/estado. Como a Fase 04 introduz visibilidade public/unlisted, a F03-03 deve declarar explicitamente o padrão e a migração para esse modelo sem confundir `ready` (processamento) com `published` (visibilidade).

**Consequences:** API pode tornar-se gargalo de banda e conexões em grande escala; CDN/presign é evolução futura que exige nova decisão de autorização. Range/206 foi escolhido como protocolo concreto, portanto testes de 206/416 são obrigatórios. S3 não atende múltiplos ranges em uma única chamada `GetObject`; a API rejeita ou limita essa forma conforme plano. [RFC 9110 Range/206/416](https://www.rfc-editor.org/rfc/rfc9110.html), [S3 GetObject Range](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

## TD-06: Máquina de estados e handoff banco → fila

**Scope:** Backend

**Capability:** Pré-cadastro como rascunho; processamento automático após upload; URL e entrega apenas quando o vídeo estiver pronto.

**Context:** Não há transação atômica entre PostgreSQL, S3 e Redis. A confirmação pode repetir; API, dispatcher e worker podem cair em qualquer fronteira.

| Opção | Vantagens | Custos e riscos |
| --- | --- | --- |
| A. Enfileirar diretamente na confirmação | Simples. | Commit no DB e publish no Redis podem divergir; perda de job após confirmação. |
| B. Intenção durável em PostgreSQL + publicação/reconciliação na F03-07 | Recupera quedas e permite auditoria; alinhada às notas BIAWS. | Tabela/outbox e dispatcher adicionais; sem exatamente uma vez, exige idempotência. |
| C. Tratar Redis como fonte única de estado | Menos tabela. | Perda/retenção do Redis ou limpeza de jobs pode ocultar vídeo confirmado. |

**Recommendation / Decision:** **B.** Estados mínimos persistidos: `draft → processing → ready | error`. `draft` significa registro criado e upload em andamento/pendente de confirmação. Confirmação válida, executada pela F03-06, grava uma única intenção versionada de processamento **na mesma transação** que marca o upload confirmado; não publica job. F03-07 é a única publicadora: dispatcher consulta intenções pendentes, publica na fila com `jobId` estável derivado de `videoId` e geração, registra confirmação de publish e reconcilia periodicamente intenções sem job observável. Tentativas técnicas da mesma geração preservam o ID lógico; reprocessamento explícito incrementa a geração. A F03-03 define o ponto exato da transição para `processing`, leasing/reclaim do dispatcher, frequência de reconciliação e como distinguir upload confirmado de draft incompleto. O worker faz claim/transições condicionais no banco; redelivery vê `ready` e sai sem efeitos, ou retoma uma geração incompleta sem regredir estado. Escrita de thumbnail é determinística por geração; atualização do banco acontece só após o objeto existir. Tentativas finitas, falha terminal `error`; reprocessamento explícito cria nova geração e nova intenção, nunca reutiliza silenciosamente um job concluído. Erros transitórios não liberam o vídeo para leitura.

**Idempotência e recuperação:** A confirmação repetida retorna o mesmo vídeo/intenção, sem segunda publicação lógica. Entre commit e publish, a intenção permanece pendente e o dispatcher a recupera. Entre publish e marcação como publicada, pode haver republicação; `jobId` reduz duplicações enquanto retido e o worker é idempotente mesmo após remoção do job. Redis AOF e volume reduzem perda, mas a reconciliação compara o banco com o estado da fila e republica quando necessário. Usar `FOR UPDATE SKIP LOCKED` ou claim condicional para múltiplos dispatchers; a F03-03 fixa índices, timestamps, leases e isolamento. Não usar `jobId` sozinho como garantia de exatamente uma vez.

**Consequences:** F03-09 precisa injetar falhas em confirmação, publicação, ack, redelivery, worker e reinício. F03-10 só marca a DoD após o fluxo real. [PostgreSQL 17 SELECT / SKIP LOCKED](https://www.postgresql.org/docs/17/sql-select.html), [BullMQ job IDs](https://docs.bullmq.io/guide/jobs/job-ids), [BullMQ stalled](https://docs.bullmq.io/guide/jobs/stalled), [Redis AOF](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).

## Próxima etapa e verificação exigida

F03-03 transforma estas escolhas em Data Model, contratos HTTP, Authorization Matrix, Error Catalog, Events/Messages, limites e SIs. Deve fixar versões de `@nestjs/bullmq`/`bullmq`, `@aws-sdk/client-s3`/`@aws-sdk/s3-request-presigner`, Redis/MinIO/FFmpeg, confirmar peers e compatibilidade MinIO com assinatura de `UploadPart`, `ListParts`, CORS, `CompleteMultipartUpload`, `HeadObject` e `GetObject(Range)`. Testes de integração com MinIO, Redis, PostgreSQL e fixture de vídeo são condição de implementação, não evidência desta pesquisa. Esta F03-02 não mudou código nem dependências.

## F03-03 — Contract resolutions after validation

These refinements close the planning ambiguities found in `docs/phases/phase-03-videos/validation.md`; they preserve TD-01..06 and are the input to the executable plan.

- **Multipart boundary:** 10 GB means `10_000_000_000` bytes. Fixed 16 MiB parts, except the last; at most 597 parts. The server signs only part numbers in the declared range, at most 20 per request, for 15 minutes. Upload expires after 24 hours. Before `CompleteMultipartUpload`, the API compares the client's ordered ETags with paginated `ListParts` and verifies every expected part size and the exact declared total. On S3 completion followed by DB failure, retry/reconciliation uses `HeadObject` and the persisted upload ID/key to finish the DB confirmation and durable intent; it never starts a second upload for that video. Cancellation/expiry aborts incomplete multipart and makes that draft terminal; the client starts a new video to retry. The worker validates actual content with ffprobe before `ready`.
- **Visibility in this phase:** metadata, original stream, download and thumbnail of a `ready` video are anonymously accessible to anyone with its opaque URL; no public listing/search is added. Draft, processing and error records are accessible only through authenticated owner endpoints and cannot be read through the public URL. This is a temporary ready-by-link rule, not a Fase 04 public/unlisted setting. Fase 04 will add explicit visibility with migration; the opaque ID is not an authorization token for private states.
- **Storage credentials:** the API's private proxy requires `GetObject` on ready originals/thumbnails in addition to multipart orchestration. Use separate MinIO service accounts/policies: API can initiate/sign/list/complete/abort/read originals and read thumbnails; worker can read originals and write thumbnails; bucket initializer alone has administrative permissions. No root storage credentials in API/worker. This refines TD-03's permission sketch without changing its private-bucket decision.
- **State and retry:** accepted transitions are `draft → processing`, `draft → error` (invalid/expired/cancelled upload), `processing → ready|error`, and `error → processing` only after an authenticated, explicit reprocess request for a previously confirmed object that increments generation. `ready` is terminal in Fase 03. Confirmation changes `upload_confirmed_at` and inserts outbox in one PostgreSQL transaction while status remains `draft`; the worker claims `processing`. A draft with confirmed upload is distinguishable from an incomplete draft. No automatic retry of invalid media.
- **Handoff:** F03-06 is responsible for upload confirmation and one outbox row per `(video_id,generation)`, never queue publication. F03-07 owns a dispatcher with 2-minute DB leases, scans every 30 seconds and uses a stable `video-{uuid}-g{generation}` BullMQ `jobId`. It reconciles a published but missing job after two minutes while the video is unfinished. Worker claim uses generation plus a renewable DB processing lease/token; every DB finalization checks that token. Redis may deliver or replay more than once; duplicate compute after a crash cannot be ruled out, but only one generation may become `ready` and thumbnail writes use a deterministic key. Terminal BullMQ failure sets video `error`; reconciliation handles a missed failure event. Explicit reprocess creates the next generation and outbox row. Stalled/retained jobs never override `ready` or a newer generation. On a clean database startup, the worker waits for the versioned video migration before creating the consumer/dispatcher or reporting healthy.
- **Streaming:** one `bytes` range per request is supported; malformed/unsatisfiable single ranges produce `416` with `Content-Range: bytes */{size}`. Multiple ranges or an unknown range unit return `400 UNSUPPORTED_RANGE`. `If-Range` with the exact current strong ETag permits partial response; a mismatch or date form causes a full `200`. `HEAD` returns full-object headers and no body. Download shares the streaming path with safe `Content-Disposition: attachment`. The client response never contains S3 keys or a presigned GET URL.
- **Resource defaults for implementation:** worker concurrency 1, up to 3 attempts with exponential backoff starting at 30 seconds, `maxStalledCount=1`, 12 GiB free temporary disk per worker, 2-hour whole-job deadline, 60-second ffprobe and 120-second FFmpeg deadlines, 30-second dispatcher interval. These are configuration defaults with Joi bounds and integration tests, not a claim that the host already has the needed disk.
- **Version/source route:** `library-refs.md` fixes `@nestjs/bullmq` 11.0.5, BullMQ 5.81.5, AWS SDK modules 3.1136.0, Redis `7.4.7-alpine`, MinIO Community source `RELEASE.2025-10-15T17-29-55Z` built locally, and the worker's Debian FFmpeg candidate 5.1.9. F03-04 verifies actual registry/build and S3 behavior before implementation proceeds. MinIO's source repository is archived, so no unverified image substitute is assumed.
- **F03-04 CORS compatibility finding:** The pinned MinIO Community build returned `NotImplemented` for `mc cors set` on the originals bucket. The bucket CORS documentation applies to AIStor; Community supports the global `MINIO_API_CORS_ALLOW_ORIGIN` setting. Local Compose applies the configured origin globally and the real smoke must verify browser-readable `ETag`. This changes server configuration, not the direct multipart upload contract. [Community answer](https://github.com/minio/minio/discussions/20841), [server configuration](https://github.com/minio/minio/blob/master/docs/config/README.md).
- **F03-04 stale-upload cleanup:** MinIO Community rejected a standalone S3 `AbortIncompleteMultipartUpload` lifecycle rule in local verification. Its supported `MINIO_API_STALE_UPLOADS_EXPIRY` and cleanup interval are set to 48 hours and one hour in Compose; application upload TTL is 24 hours. Production S3 needs an equivalent bucket lifecycle rule. [MinIO server configuration](https://github.com/minio/minio/blob/master/docs/config/README.md).

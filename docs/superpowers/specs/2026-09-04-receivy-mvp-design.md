# Receivy MVP — Design

## 1. Objetivo

Construir um aplicativo brasileiro para organizar cobranças pessoais e receber de outras pessoas sem exigir que o pagador instale o app. A cobrança é a entidade central, a timeline é a interface principal, recorrências automatizam a criação de cobranças e o pagamento é conciliado manualmente pelo credor.

O MVP deve permitir que a mesma pessoa seja credora e devedora ao mesmo tempo. O Receivy não movimenta dinheiro, não consulta contas bancárias e não confirma Pix automaticamente.

### Critérios de sucesso

- Uma pessoa autenticada cria e compartilha uma cobrança avulsa em menos de 30 segundos.
- Um pagador sem conta abre o link, copia a chave Pix e envia um comprovante sem instalar o app.
- O credor revisa o comprovante e liquida a cobrança com uma decisão explícita.
- Compras parceladas e rateadas sempre preservam o total exato em centavos.
- Recorrências mensais e anuais geram cobranças uma única vez, preservando snapshots históricos.
- Uma conta enxerga na mesma timeline tudo que tem a receber e a pagar.

## 2. Escopo

### Incluído

- Login sem senha por e-mail + código, Google e Apple.
- Pessoas sem conta como contatos de primeira classe e vinculação posterior por e-mail verificado.
- Compras avulsas e parceladas, para uma ou várias pessoas.
- Rateio por valor fixo, partes iguais ou porcentagem, incluindo a parte do próprio credor.
- Recorrências mensais e anuais.
- Timeline combinada de valores a receber e a pagar, com filtros.
- Chaves Pix para exibição e cópia.
- Link público privado por capacidade e envio manual de comprovante.
- Confirmação, rejeição e marcação manual de pagamento integral.
- E-mail e push; compartilhamento manual por apps do dispositivo.
- Perfil, preferências, exportação e exclusão de conta.
- Web responsivo e aplicativos iOS/Android.

### Fora do MVP

- Grupos.
- Senhas, cadastro separado e recuperação de senha.
- Pagamentos parciais, saldo em carteira, conta digital ou movimentação de dinheiro.
- QR Code Pix, Pix Cobrança, PSP/banco, webhook ou baixa automática.
- Cartões, débito automático e “Auto-Pix”.
- OCR, leitura de recibo/nota, Smart Scan e relatórios avançados.
- Assinatura Premium, paywall e cobrança do usuário.
- WhatsApp automático, SMS e importação da agenda do telefone.
- Merge manual de contatos duplicados e exclusão de histórico financeiro isolado.

## 3. Referências e princípios

- `~/Projects/rewarlo` é a referência principal para pnpm, Next como BFF, Expo, API EZ4, Neon, sessões rotativas, Docker e deploy.
- `~/FreightHero/backend` é referência para módulos por domínio, repositories/endpoints/schemas, idempotência e separação entre transação e efeitos externos.
- `~/Downloads/stitch_personal_debt_expense_tracker` é a referência visual, não a fonte final de comportamento ou copy.
- O Stitch será adaptado para a marca **Receivy**. Devem ser removidas promessas de criptografia ponta a ponta, reconhecimento bancário, liquidação instantânea, cartão, Auto-Pix, QR Pix e WhatsApp automático.
- Não compartilhar componentes de UI entre web e mobile. Compartilhar contratos, regras puras e tokens de design.

## 4. Arquitetura

### Monorepo

Usar pnpm workspaces e Turborepo:

```text
packages/
  api/       # projeto EZ4 e domínio do backend
  common/    # tipos, enums, contratos, regras puras e design tokens portáveis
  mobile/    # Expo Router, iOS e Android
  web/       # Next App Router, BFF e página pública
```

Versões-base:

- Node.js 24 em desenvolvimento, CI, Lambda e imagens Docker.
- pnpm 11.5.3 fixado em `packageManager` e habilitado com Corepack.
- EZ4 0.52.0, com runtime `RuntimeType.Node24` e arquitetura ARM.
- Next 16.2.x com React 19.2.3.
- Expo SDK 56, React Native 0.85, Expo Router e Uniwind.
- TypeScript estrito; builds nunca ignoram erros de tipos.

O lockfile é único. Dependências compartilhadas ficam no catálogo do `pnpm-workspace.yaml`. Os patches locais de `@ez4/raw-pg` e `@ez4/aws-common` usados pelo Rewarlo devem ser inicialmente vendorados e documentados; antes de cada upgrade, verificar se o upstream já incorporou as correções.

### Fluxo de rede

```text
Browser -> Next BFF -> API EZ4 -> Neon/S3/Resend/Expo Push
Mobile  ------------> API EZ4 -> Neon/S3/Resend/Expo Push
Link público -> Next -> endpoint público EZ4 escopado à cobrança
```

O browser não chama endpoints autenticados da API diretamente. Server Actions e Route Handlers do Next fazem o papel de BFF. O mobile usa a API diretamente. Neon e S3 nunca são acessíveis diretamente pelos clientes, exceto por URLs S3 pré-assinadas e restritas para upload/download.

### Backend

`packages/api` é um monólito modular com um projeto EZ4 e um banco. Cada domínio contém endpoints, repositories, schemas, services e jobs somente quando necessários:

```text
src/
  auth/
  people/
  payment-methods/
  expenses/
  charges/
  recurrences/
  proofs/
  timeline/
  notifications/
  account/
  public/
  api.ts
  cron.ts
  database.ts
  provider.ts
```

Efeitos externos nunca rodam dentro da transação do banco. A transação grava a alteração de domínio e uma linha de outbox; um job posterior entrega e-mail/push ou processa arquivo.

### Infraestrutura

- API EZ4 na AWS `sa-east-1`, em ambientes `dev` e `prd`.
- Estado EZ4 remoto em S3, separado por ambiente, seguindo o `ez4.project.js` e a correção de remote state do Rewarlo.
- Neon Postgres com projeto/branch por ambiente e conexão TLS.
- Bucket S3 privado por ambiente para comprovantes, com criptografia gerenciada, CORS restrito e lifecycle configurável.
- Resend para e-mail, com transporte local que registra apenas metadados seguros.
- Expo Push Service para notificações de dispositivos registrados.
- Web entregue como imagem Docker multi-stage `node:24-slim`, Next `output: "standalone"`, baseada na imagem do Rewarlo e sem `ignoreBuildErrors`.
- Mobile preparado para EAS Build com development builds, pois Google nativo exige módulos fora do Expo Go.

## 5. Modelo de domínio

Todos os IDs são UUID. Valores monetários usam inteiros em centavos e código ISO 4217; datas de vencimento usam `date`, instantes usam UTC e regras de calendário usam o timezone IANA do usuário. O lançamento suporta BRL/`pt-BR`/`BR`/`America/Sao_Paulo`, mas esses campos existem desde o início.

### Identidade e sessão

- `users`: e-mail normalizado único, nome, avatar, locale, timezone, country, timestamps e exclusão lógica durante o processo de encerramento.
- `auth_identities`: `email | google | apple`, subject do provedor e e-mail verificado observado. `(provider, provider_subject)` é único.
- `login_codes`: e-mail normalizado, HMAC do código, tentativas, expiração, consumo e timestamps.
- `session_families`: usuário, expiração, revogação, dispositivo e timestamps.
- `refresh_tokens`: família, hash do token opaco, expiração, consumo e substituição.

Ao autenticar por e-mail, Google ou Apple, somente um e-mail confirmado pelo provedor pode localizar uma conta existente. O login cria o usuário quando necessário. Apple Private Relay é um e-mail legítimo separado; no MVP ele não é fundido com outro endereço. Para enxergar cobranças enviadas a outro e-mail, a pessoa deve entrar diretamente com aquele endereço; merge de contas e e-mails adicionais ficam fora do escopo.

### Pessoas

- `people`: proprietário, nome, `linked_user_id` opcional, estado ativo/arquivado e timestamps.
- `person_contacts`: pessoa, tipo `email | phone`, valor original, valor normalizado, preferência e timestamps.

Cada pessoa pertence a quem a cadastrou; não existe agenda global compartilhada. Após qualquer login bem-sucedido, a API vincula atomicamente ao usuário todos os contatos ainda não vinculados cujo e-mail normalizado corresponda ao e-mail verificado. Dentro do mesmo proprietário, impedir duas pessoas ativas com o mesmo e-mail normalizado. Histórico impede hard delete; a ação de remoção arquiva.

### Compras, rateios e cobranças

- `expenses`: proprietário, tipo `one_time | installment`, descrição, total, moeda, número de parcelas, primeiro vencimento e timestamps.
- `expense_allocations`: parte `owner | person`, pessoa opcional, modo de rateio, valor/percentual resolvido e ordem determinística.
- `charges`: credor, pessoa devedora, origem (`expense | recurrence`), referências de origem, descrição snapshot, valor, moeda, vencimento, parcela/total de parcelas, instrução Pix snapshot, estado `pending | paid | cancelled` e timestamps.

Regras de rateio:

- `fixed`: valores externos não podem ultrapassar o total; o restante é do proprietário.
- `equal`: dividir entre as partes selecionadas; centavos residuais seguem a ordem estável das alocações.
- `percentage`: total obrigatório de 10.000 basis points; usar largest remainder com desempate pela ordem estável.
- Primeiro resolver a participação total de cada parte; depois distribuir cada participação pelas parcelas. A soma por pessoa e por despesa deve permanecer exata.
- A parte do proprietário não cria `Charge`.

Todas as parcelas são persistidas na criação da compra. Uma cobrança gerada é snapshot: alterações posteriores no contato, na chave Pix ou em regras futuras não alteram descrição, valor, vencimento e rateio históricos.

`overdue` é derivado de `pending && due_date < hoje_no_timezone`. `proof_pending` é derivado da existência de comprovante pendente; nenhum dos dois é gravado como estado da cobrança.

### Recorrências

- `recurrences`: proprietário, descrição, total, moeda, frequência `monthly | yearly`, dia/mês de cobrança, início/fim opcionais, timezone, chave Pix, estado `active | paused | ended` e timestamps.
- `recurrence_allocations`: mesmas regras de alocação de uma compra.
- `recurrence_reminders`: offsets em dias e canal permitido.
- `recurrence_occurrences`: recorrência, data da ocorrência e instante de materialização; `(recurrence_id, occurrence_date)` é único.

Padrão de lembretes: três dias antes, no vencimento e dois dias depois. A ocorrência vira cobranças reais na janela do primeiro lembrete habilitado; se não houver lembrete, no vencimento. O job roda de hora em hora, calcula o dia local de cada recorrência e usa a constraint única para ser idempotente.

Datas mensais de 29–31 são limitadas ao último dia do mês. Uma anual em 29 de fevereiro usa 28 de fevereiro em anos não bissextos. Edições afetam apenas ocorrências ainda não materializadas. A timeline pode projetar até 90 dias de ocorrências futuras sem gravá-las.

### Pagamento, comprovante e Pix

- `payment_methods`: proprietário, tipo `pix`, tipo da chave, valor, rótulo, preferência, estado ativo/arquivado e timestamps.
- `public_links`: ID público aleatório, cobrança, versão do token, expiração, revogação e timestamps.
- `payment_proofs`: cobrança, remetente autenticado opcional, objeto S3, nome original, MIME, tamanho, SHA-256, estado `pending | accepted | rejected`, revisor, motivo e timestamps.
- `payments`: cobrança única, comprovante opcional, valor integral, método `pix | cash | transfer | other`, registrador e data do pagamento.

O MVP apenas exibe/copia a chave Pix. Aceitar um comprovante cria um pagamento integral e muda a cobrança para `paid` na mesma transação. Rejeitar mantém a cobrança pendente e preserva o comprovante. O credor também pode marcar como pago sem arquivo. Não aceitar novo pagamento para cobrança paga/cancelada.

### Timeline, notificações e auditoria

- `activity_events`: evento append-only com ator, usuários afetados, tipo, referência, payload mínimo e timestamp.
- `device_tokens`: usuário, plataforma, token Expo, dispositivo, validade e timestamps.
- `notification_preferences`: defaults globais do usuário.
- `notification_deliveries`: destinatário, canal `email | push`, template, referência, idempotency key, estado, tentativas e timestamps.

A timeline combina eventos/cobranças persistidos com ocorrências futuras calculadas. A direção é sempre relativa ao usuário autenticado: `receivable` quando ele é credor e `payable` quando uma `Person` vinculada a ele é devedora.

Canal automático: push quando o devedor tem conta e token ativo; caso contrário, e-mail quando o contato tem endereço; sem ambos, apenas compartilhamento manual. Criar cobrança envia um aviso inicial e agenda os lembretes habilitados. Falhas usam retry com backoff e dead-letter observável, sem desfazer a transação de negócio.

## 6. Contratos públicos

`packages/common` contém enums, value objects, DTOs e regras puras, sem importar Node, Next, React ou React Native. Os schemas de infraestrutura EZ4 permanecem no backend. A API gera OpenAPI para conferência e documentação.

### Tipos centrais

```ts
type Money = { amountCents: number; currency: "BRL" };
type Direction = "receivable" | "payable";
type ChargeState = "pending" | "paid" | "cancelled";
type ProofState = "pending" | "accepted" | "rejected";
type SplitMode = "fixed" | "equal" | "percentage";
type RecurrenceFrequency = "monthly" | "yearly";

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
};

type TimelineItem =
  | { kind: "charge"; direction: Direction; charge: ChargeSummary }
  | { kind: "proof"; direction: Direction; proof: ProofSummary }
  | { kind: "payment"; direction: Direction; payment: PaymentSummary }
  | { kind: "recurrence_preview"; direction: "receivable"; preview: RecurrencePreview };
```

### Endpoints autenticados

- Auth: solicitar/confirmar código; iniciar/concluir Google e Apple; refresh; logout; `me`.
- Conta: atualizar perfil, exportar dados, solicitar exclusão e listar/revogar sessões.
- Pessoas: listar, criar, ler, editar, arquivar e consultar ledger entre as partes.
- Chaves Pix: listar, criar, editar, tornar principal e arquivar.
- Despesas: criar e ler compra com rateio/parcelas.
- Cobranças: ler, cancelar, lembrar, marcar como paga e rotacionar link público.
- Comprovantes: aceitar ou rejeitar.
- Recorrências: listar, criar, ler, editar, pausar/reativar, encerrar e simular próximas ocorrências.
- Timeline: cursor paginado com `direction`, `status`, `source`, `from` e `to`.
- Dispositivos: registrar/atualizar/remover token push.

### Endpoints públicos

- Ler a visão mínima de uma cobrança por token.
- Pedir URL pré-assinada para comprovante.
- Finalizar o comprovante após upload.

O endpoint de solicitação de código sempre retorna `204`, mesmo se o e-mail for novo, existente, bloqueado por cooldown ou não entregável. Erros de confirmação não revelam qual condição falhou. Endpoints autenticados usam bearer token somente entre BFF/mobile e API.

## 7. Autenticação e segurança

### Código por e-mail

- Seis dígitos gerados com CSPRNG.
- TTL de 10 minutos, no máximo cinco tentativas e cooldown de 60 segundos.
- Reenvio invalida códigos anteriores.
- HMAC-SHA-256 com chave de 32 bytes separada; comparação em tempo constante.
- Limite por hash de e-mail e por IP, além do throttling do API Gateway.
- Consumo, criação/vinculação de usuário e emissão de sessão são atômicos.
- Nunca registrar código, hash, token ou corpo do e-mail.

### Google e Apple

- Authorization Code Flow com PKCE, state e nonce.
- Callback web passa pelo Next/API; o mobile usa credenciais nativas e troca server-side.
- Validar issuer, audience, assinatura, expiração, nonce e e-mail verificado.
- Persistir nome/e-mail recebidos da Apple no primeiro login.
- Registrar domínio remetente no Private Email Relay da Apple antes de enviar e-mail para endereços relay.

### Sessões

- Access JWT de 15 minutos com audience/issuer e claims mínimas.
- Refresh opaco aleatório de 30 dias; só o hash fica no banco.
- Rotação do par a cada refresh; replay revoga a família inteira.
- Logout revoga a família atual; ajustes permitem revogar outros dispositivos.
- Next usa cookies `__Host-receivy_access` e `__Host-receivy_refresh` com `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sem `Domain`.
- Mobile usa `expo-secure-store` e colapsa refreshes concorrentes da mesma sessão.
- Nenhum token em LocalStorage, AsyncStorage, URL ou logs.

### Link público e uploads

- Token de capacidade no formato `publicId.expires.signature`, assinado com HMAC-SHA-256 sobre ID, versão e expiração. Nenhum token completo ou segredo recuperável fica no banco.
- Link vale 90 dias, pode ser regenerado pelo credor, rotacionado ao incrementar a versão, revogado e deixa de aceitar upload quando a cobrança é paga/cancelada.
- Expor apenas primeiro nome do credor, descrição, valor, vencimento, estado e chave Pix aplicável. Não expor e-mail, telefone, IDs internos ou outros débitos.
- Página com `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, CSP restrita e sem scripts de analytics.
- Upload pré-assinado limitado a 10 MB e tipos JPG/PNG/PDF; confirmar tamanho, magic bytes, hash e ownership do objeto antes de criar `PaymentProof`.
- Objetos são privados, nomes são gerados pelo servidor e downloads usam URL curta com `Content-Disposition: attachment`.
- Rate limit por token público e IP; no máximo um upload pendente por vez por cobrança, mas uma rejeição permite nova tentativa.

### Autorização e privacidade

- Toda operação valida ownership no repository/service; a UI nunca é fronteira de segurança.
- Devedor autenticado pode ler a cobrança e seus próprios comprovantes, mas não editar valor, revisar pagamento ou ler contatos do credor.
- Credor pode administrar apenas objetos que criou.
- Logs estruturados usam correlation ID e redigem e-mail completo, telefone, chave Pix, tokens, URLs assinadas e nomes de arquivo.
- Exportação produz JSON assinado e temporário. Exclusão revoga sessões/links, remove arquivos, apaga contatos sem obrigação de retenção e anonimiza referências necessárias à consistência antes da remoção final.
- Termos e política deixam explícito que o Receivy é um organizador de registros pessoais, não instituição de pagamento.

## 8. Experiência do usuário

### Navegação

Mobile usa tabs inferiores: `Timeline`, `Recorrências`, `Contatos`, `Ajustes`. Web usa sidebar equivalente em desktop e barra inferior em viewport móvel. `+` abre cobrança rápida; criação de recorrência fica também na área de Recorrências.

### Login e onboarding

- Tela de entrada oferece Google, Apple e e-mail.
- E-mail abre a tela de seis dígitos com contador de reenvio e opção de corrigir endereço.
- Primeiro acesso pede somente nome; locale/timezone/country vêm do dispositivo e podem ser corrigidos.
- Se o usuário já estava cadastrado como `Person`, a timeline vinculada aparece imediatamente.
- Chave Pix é solicitada ao tentar compartilhar a primeira cobrança, não bloqueia o onboarding.

### Timeline

- Uma única timeline ordenada por data, misturando passado recente, hoje e futuro.
- Resumo superior mostra separadamente total a receber, total a pagar, atrasadas, pendentes e comprovantes para revisar.
- Todo item exibe badge `A receber` ou `A pagar`.
- Filtros: Todos, A receber, A pagar, Hoje, Esta semana, Recorrências e status.
- Futuro virtual usa aparência distinta e nunca oferece ações de uma cobrança ainda não criada.
- Desktop mostra timeline e painel de detalhe lado a lado; mobile navega para detalhe.

### Nova cobrança

1. Selecionar uma ou várias pessoas recentes ou criar contato.
2. Informar total e descrição opcional.
3. Escolher avulsa ou parcelada.
4. Definir rateio fixo/igual/percentual, incluindo “eu/restante”.
5. Definir primeiro vencimento e quantidade de parcelas.
6. Selecionar chave Pix.
7. Revisar totais por pessoa/parcela antes de confirmar.
8. Criar e abrir compartilhamento do sistema com o link público.

### Recorrências

- Lista e detalhe mantêm o nome `Recorrências`, pois gerenciam regras, não cobranças concretas.
- Criar/editar descrição, total, frequência mensal/anual, data, participantes, rateio, chave Pix e lembretes.
- Tela mostra próxima materialização e simulação de 90 dias.
- Substituir cartões/Auto-Pix do Stitch por “chave Pix usada nos links”.

### Contatos

- Lista permite buscar e criar pessoas.
- Detalhe permite editar nome/e-mail/telefone, ver estado `Com conta | Sem conta`, saldo entre as partes e histórico.
- Ações: nova cobrança, copiar/reenviar link de cobrança pendente e arquivar contato.
- Não importar agenda do aparelho. Não apagar pessoa com histórico; arquivar preserva cobranças.

### Cobrança e comprovante

- Credor: copiar link, lembrar, cancelar, marcar paga, baixar comprovante, aceitar ou rejeitar com motivo opcional.
- Devedor autenticado: ver dados, copiar chave Pix, enviar/substituir tentativa rejeitada e acompanhar revisão.
- A timeline atualiza após cada transição e mantém o histórico.

### Página pública

- Marca Receivy, contexto mínimo da cobrança, chave Pix com copiar e upload de comprovante.
- Sem QR e sem afirmação de pagamento instantâneo ou baixa automática.
- Após upload, mostrar “Comprovante enviado para revisão”. Após pagamento/cancelamento, desabilitar upload.

### Ajustes

- Perfil, locale/timezone, chaves Pix, preferências de aviso, dispositivos/sessões, exportar dados, excluir conta, termos e privacidade.

## 9. Tratamento de erros

- Erros públicos seguem envelope `{ code, message, correlationId, fieldErrors? }`; clients traduzem `code`, não texto do backend.
- Validação retorna 400; falta de autenticação 401; falta de acesso 403; recurso inexistente 404; conflito de estado/idempotência 409; rate limit 429.
- Criar despesa/recorrência é atômico. Em retry com a mesma `Idempotency-Key`, retornar o resultado original.
- E-mail/push falho não desfaz cobrança; fica na outbox para retry.
- Upload S3 órfão é removido por lifecycle; finalização inválida não cria comprovante.
- UI preserva formulário em erro recuperável, mostra feedback acessível e oferece retry.

## 10. Testes e aceite

### Backend

- OTP: geração, HMAC, expiração, consumo único, cinco tentativas, cooldown, reenvio, resposta anti-enumeração e rate limit.
- OAuth: state/nonce/PKCE, claims inválidas, Apple sem nome subsequente, e-mail verificado e conflitos de identidade.
- Sessão: rotação concorrente, replay, expiração, logout e revogação de dispositivo.
- Autorização: matriz credor/devedor/terceiro/token público para todos os recursos.
- Rateio: fixo, igual, percentual, centavos residuais, parte do dono e parcelas; property tests preservam somas.
- Recorrência: mensal/anual, fim de mês, 29/2, timezone, pausa, edição futura e job idempotente.
- Comprovante: MIME/tamanho/magic bytes, cobrança paga/cancelada, aceitar/rejeitar e concorrência de revisão.
- Outbox: deduplicação, retry/backoff e falha permanente.
- Conta: vinculação de `Person`, exportação, exclusão e revogação.

### Web

- Vitest + Testing Library para formulários, filtros e transições.
- Playwright para e-mail/código, Google/Apple com provider mock, criar/ratear/parcelar cobrança, timeline combinada, link público, upload/revisão e recorrência.
- Verificar cookies HttpOnly/Secure/SameSite, ausência de tokens no bundle/storage e headers da página pública.
- Viewports 390 px, 768 px e 1440 px; teclado, foco visível, contraste e touch targets de 48 px.

### Mobile

- Jest/React Native Testing Library para telas, estado de sessão e formulários.
- Testes de serviços para SecureStore, refresh concorrente, deep links OAuth e registro push.
- Smoke E2E em development build iOS/Android para Apple, Google, código, cobrança, timeline e upload.
- `expo-doctor` e build EAS de ambos os sistemas.

### Gates do monorepo

- `pnpm lint`, `pnpm check-types`, `pnpm test` e `pnpm build` passam.
- Testes HTTP EZ4 passam contra Postgres local via Docker.
- Imagem Docker do web compila e executa em Node 24.
- `ez4 output` lê o remote state antes de qualquer deploy.
- OpenAPI é gerada e conferida contra os clients.

## 11. Entrega incremental

1. Fundação do monorepo, design tokens, ambientes, Postgres local, EZ4, Docker e CI.
2. Auth/sessões/contas nos três clientes.
3. Pessoas, chaves Pix e vinculação por e-mail.
4. Despesas, rateio, parcelas, cobranças e links públicos.
5. Comprovantes, pagamentos e auditoria.
6. Timeline combinada e detalhes.
7. Recorrências, projeção futura e materialização idempotente.
8. E-mail, push, preferências e retries.
9. Exportação/exclusão, hardening, acessibilidade, E2E e preparação de deploy.

Cada incremento deve terminar utilizável, testado e revisável. Nenhuma etapa deve introduzir OCR, Premium, WhatsApp automático ou integração financeira como “preparação”.

## 12. Assunções fechadas

- A marca é Receivy; `RecebaFácil` e `Emerald Ledger` são apenas artefatos do Stitch.
- O produto inicial é Brasil/BRL, mas persiste locale, timezone, country e currency.
- Web e mobile têm paridade funcional, com composição visual apropriada a cada plataforma.
- Página pública funciona sem conta e é o único fluxo financeiro acessível anonimamente.
- Login é sem senha, com e-mail + código, Google e Apple.
- A timeline é única; direção é filtro, não um modo de conta.
- O menu usa `Recorrências`, não `Cobranças`.
- Liquidação é sempre integral e confirmada manualmente.
- Pix no MVP significa somente exibir/copiar a chave.
- Produção usa API EZ4/AWS, Neon, S3, Resend, Expo Push e imagem Docker do Next.
- Valores de domínio, domínios públicos, contas AWS/Neon/Resend/Apple/Google/Expo e segredos serão fornecidos por configuração; nenhum segredo entra no repositório.

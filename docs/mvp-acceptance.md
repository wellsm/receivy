# Aceite do MVP

Este documento distingue código implementado, prova local e dependências externas.
Uma caixa vazia não deve ser tratada como entrega concluída.

## Fluxos ponta a ponta

- [x] E-mail/código, sessão rotativa e logout implementados e testados localmente.
- [x] Google/Apple: integração implementada e validação OIDC testada com fixtures.
- [ ] Google/Apple: login real com credenciais próprias, HTTPS e retorno nativo.
- [x] Contatos: criar/editar/arquivar, duplicação, isolamento e vínculo confirmado.
- [x] Cálculos: fixo/igual/percentual, centavos, parcelas e vencimentos mensais.
- [x] Criar despesa avulsa/parcelada com contatos próprios e revisar os totais (navegador + specs).
- [x] Reenviar criação com mesma chave idempotente sem duplicar cobranças (specs nativas + componentes).
- [x] Compartilhar link, abrir anonimamente e copiar Pix sem instalar aplicativo (navegador; bytes do clipboard não lidos).
- [x] Enviar JPG/PNG/PDF privado e acompanhar revisão, inclusive rejeição/reenvio (navegador + specs).
- [x] Credor aceitar prova ou marcar pagamento integral; concorrência não duplica (prova nativa; diálogo do navegador não automatizado).
- [x] Devedor vê cobranças vinculadas; terceiro não lê nem administra registros (specs nativas; percurso visual do devedor não concluído).
- [x] Editar contato/Pix não altera snapshots ou transfere acesso ao histórico (specs nativas).
- [x] Timeline combina receber/pagar, eventos e projeções, com filtros e paginação (navegador + componentes).
- [x] Recorrência mensal/anual: configurar, simular, editar, pausar, retomar, encerrar (navegador; encerramento/anual por specs).
- [x] Job materializa uma única vez, inclusive reexecução/concorrência/fim de mês (specs nativas).
- [x] Avisos iniciais/lembretes, preferência e token push, retry/dead-letter (specs; entrega real é gate externo).
- [x] Perfil e sessões, exportação privada e exclusão consistente com terceiros (specs + HTTP; exclusão pela UI não repetida).
- [ ] Paridade web/iOS/Android, estados vazios/erro/carregando e ações acessíveis (web inspecionada; dispositivos pendentes).

## Provas técnicas

- [x] Baseline de 2026-09-06: `pnpm verify`, 91 testes e builds, antes do incremento financeiro.
- [x] `pnpm verify` após completar todos os módulos (2026-09-07, ver fechamento abaixo).
- [x] Matriz HTTP/Postgres com credor, devedor, terceiro e capacidade pública (78 cenários nativos + smoke HTTP).
- [x] Specs de integração EZ4 com DatabaseTester, fixtures tipadas e banco exclusivo
  de testes, seguindo o padrão solicitado do FreightHero; smoke HTTP complementar.
- [x] Web: 390/768/1440 px, teclado, foco, contraste e sem overflow horizontal (larguras inspecionadas por incremento; axe + teclado + contraste dos tokens automatizados em 2026-09-07; duas lacunas de contraste não-textual documentadas abaixo).
- [x] Docker: build da imagem e health após inicialização com configuração local (2026-09-07; health reporta API indisponível sem backend, por design).
- [x] OpenAPI confrontada com BFF e cliente Expo (`packages/web/src/lib/openapi-contract.test.ts`, 2026-09-07).
- [x] Smoke em development build Android (2026-09-07, emulador Pixel 8 / API 34; upload por seletor e push não exercitados).
- [x] Smoke em development build iOS (2026-09-07, simulador iPhone 17 Pro; upload por seletor de arquivos e push não exercitados).
- [ ] EAS de ambas as plataformas com identificadores e credenciais do proprietário.

## Dependências externas conhecidas

Não colocar segredos neste documento nem enviá-los na conversa. Configurá-los em
ambiente local ignorado ou no gerenciador de segredos do ambiente de execução.

| Dependência | Estado observado em 2026-09-06 | Efeito |
| --- | --- | --- |
| Xcode | 26.6 instalado em 2026-09-07 (SDK 56 exige 26.4+); runtimes iOS 26.3/26.5 | Build e smoke iOS executados no simulador; dispositivo físico pendente |
| Android | SDK 34/36, NDK 27, JDK 17, emulador arm64 (AVD clonado `Receivy_QA` com 12G) | Build Gradle e smoke executados no emulador; dispositivo físico pendente |
| Google/Apple | Providers de exemplo desativados | Fluxo real depende dos clients e callbacks próprios |
| Domínio HTTPS | Não definido no projeto | Callback Apple web e links de produção não ativados |
| S3/Neon/AWS | Nenhum ambiente de produção provisionado por esta tarefa | Não executar deploy como parte da implementação |
| IP original no EZ4 | Patches pinados (`docs/ez4-vendor-patches.md`) restauram `sourceIp` nos gateways AWS e local | Quotas por IP ativas em testes locais; comportamento no API Gateway real ainda não observado em produção |
| Resend | Transporte local de exemplo desativado | Entrega real depende de domínio e remetente verificados |
| Expo/EAS | Projeto e identificadores de publicação ainda não configurados | Push real e builds distribuíveis exigem configuração |

Requisito do Xcode: [Expo SDK 56](https://expo.dev/changelog/sdk-56).
O aviso Hermes do SDK 56 permanece documentado; a mudança para 57 não é autorizada.

## Evidência de infraestrutura — baseline

Em 2026-09-06, `docker build -f packages/web/Dockerfile -t receivy-web:mvp-local .`
passou; o container respondeu `/login` com 200 e executou como UID 1001 (nextjs),
não root. O container descartável foi parado e removido, sem volume de dados.
Essa prova ainda não é o aceite Docker final do conjunto de funcionalidades.

## Evidência financeira — API

Commits `2e5e287` e `eb59d19`: contratos e repositórios financeiros implementados,
oito cenários nativos EZ4/Postgres aprovados e 55 testes unitários da API aprovados.
A revisão independente aprovou a correção de overflow: somas/subtrações usam
BigInt e respostas numéricas fora do intervalo seguro retornam HTTP 422, sem
arredondar centavos. Leituras individuais continuam disponíveis nesse caso.

Essa evidência isolada não marca os fluxos financeiros ponta a ponta como
concluídos; as provas dos incrementos seguintes estão registradas abaixo.

## Evidência financeira — clientes

Commits `277e509`, `abcd22f` e `021d00b`: criação/revisão de despesas, timeline,
detalhes, extrato por pessoa, configuração Pix e página pública implementados em
web/Expo. A revisão independente aprovou os fluxos e as duas rodadas de correção.
O último gate completo registrou 186 testes; as correções posteriores passaram
em 53 testes web e 12 testes focados mobile, além de lint, tipos, build Next e
export Expo. Esses totais têm escopos diferentes e não devem ser somados.

As regressões cobrem preservação do corpo/chave idempotente após resposta
incerta, inclusive reenvio com 401/429; filtros sem misturar páginas antigas;
contatos paginados; percentuais localizados; centavos residuais nas parcelas;
falha ao salvar Pix sem perder o rascunho; orientação de cobranças encerradas.

QA local usou somente contas e Pix fictícios em banco descartável. Foram
inspecionadas telas em 390/768/1440 px sem overflow horizontal, criação parcelada
com total de R$ 100,01, detalhe, extrato e página pública. Na página pública em
build de produção, os scripts usaram nonce compatível com a CSP e os headers
private/no-store, no-referrer e nosniff foram conferidos. O botão de cópia exibiu
sucesso, mas a leitura independente do clipboard não confirmou seus bytes.

O diálogo nativo de confirmação impediu completar o pagamento pela automação
do navegador. O fluxo de devedor numa segunda origem de desenvolvimento também
não foi concluído. Portanto, essas etapas não são declaradas aprovadas no QA
ponta a ponta. Serviços e banco descartáveis da inspeção foram encerrados.

## Evidência de comprovantes — implementação e prova local

Commits `c542403`, `055d921` e `b5e55a2`: armazenamento privado, intenção de upload,
validação de bytes/tamanho/tipo/hash, revisão integral e recuperação de envio
implementados. O primeiro gate completo deste incremento registrou 204 testes.
As correções posteriores passaram na suíte nativa EZ4 (18 cenários), nos testes
unitários da API (60) e web (68), além de tipos e build web. São execuções de
escopos e revisões diferentes, não um único gate final do MVP.

A suíte de domínio usa `DatabaseTester` e `BucketTester.getClientMock`; testes
separados exercitam HTTP local e assinatura S3 com credenciais fictícias. Não
houve chamada à AWS nem prova de bucket/IAM/CORS em produção.

No navegador, com banco descartável e uma imagem fictícia do próprio projeto,
upload, rejeição e reenvio funcionaram. O hash do arquivo original, do registro
no banco e do objeto final coincidiu. A API emitiu o link de download com 200,
mas o download salvo não foi verificado. O diálogo nativo de confirmação impediu
concluir o aceite pelo navegador; a evidência de aceitação/concorrência permanece
nos testes de domínio, não nesse percurso visual. A inspeção ocorreu antes da
última correção de polling, que tem regressão automatizada com relógio simulado.

Os serviços e o banco descartáveis foram encerrados. Os dois arquivos fictícios
foram retirados do storage local e preservados no diretório ignorado de QA.
Recuperação durável de objetos órfãos, configuração do bucket de produção e
limitação por IP confiável continuam pendências explícitas do aceite final.

## Evidência de recorrências — implementação e prova local

Commits `de37f08` e `8703072`: regras mensais/anuais, edição futura, pausa/retomada,
encerramento, projeções e materialização horária implementados em API/web/Expo.
A revisão independente aprovou seis correções. O gate completo passou com
249 testes de unidade/componentes; a suíte nativa terminou com 27 cenários
(9 recorrências, 10 comprovantes, 8 financeiros). O teste nativo acrescentado
depois do gate completo passou também na checagem de tipos dos testes.

As regressões verificam fim de mês/ano bissexto, replay, concorrência, snapshots,
retomada e atraso do agendador. O limite global de 100 tentativas inclui falhas,
com rodízio entre regras; uma marcação de falha antiga não desfaz progresso novo.
O smoke HTTP complementar confirmou criação/leitura/listagem e os três tipos de
rateio através do schema real do EZ4. Ele detectou a perda de campos herdados
por `Omit` na reflexão do contrato; o contrato explícito corrigiu esse problema.

No navegador, a versão corrigida criou R$ 100,01 divididos em R$ 50,01/R$ 50,00,
invalidou a revisão ao adicionar lembrete, preservou a digitação sequencial de
`-5` e recuperou os quatro lembretes após recarregar. Detalhe, pausa e reativação
funcionaram; previsões para dia 31 ajustaram setembro/novembro para dia 30.
Na timeline, as projeções não disponibilizavam pagamento e os saldos reais
continuavam zerados. Não houve envio real nem alteração do banco normal.

Telas em 390/768/1440 px foram inspecionadas sem overflow horizontal. Os botões
secundários mediram 44 px; ajuste para o alvo de 48 px está no fechamento visual.
Encerramento e cenários anuais têm evidência automatizada, não uma repetição
nesse percurso do navegador. A validação em dispositivo e na nuvem permanece
externa. Navegador, servidores e banco descartáveis foram encerrados.

## Evidência de notificações e limpeza

Commits `62af323`, `b6b081f` e `ac8b95e`: avisos iniciais/lembretes, preferências,
registro/remoção de dispositivos, histórico de envio, retry e limpeza durável
implementados. Revisão independente aprovou as correções de confirmação do push,
remoção entre contas e rotação de token, sem transferir históricos entre usuários.

O gate completo registrou 257 testes de unidade/componentes. A última correção
passou em 48 integrações nativas, cinco testes de transporte, dois testes de
preferências por plataforma e checagens focadas de tipos/lint. O smoke HTTP
conferiu DTOs, isolamento e limite concorrente de lembrete manual. Esses resultados
têm escopos diferentes e não devem ser somados como uma única execução.

No navegador, preferências de e-mail/push e dias persistiram após recarregar;
entrada inválida mostrou orientação sem perder o rascunho. A tela móvel de 390 px
foi inspecionada sem overflow. Dispositivos físicos e entrega real não foram
testados; todos os provedores permaneceram desativados ou simulados explicitamente
na fronteira dos testes. O ambiente descartável foi encerrado e removido.

Aceitação incerta não gera reenvio cego nem fallback automático, portanto um aviso
pode não chegar. Lembretes manuais são novos eventos limitados. Avisos automáticos
de revisão/pagamento não integram esse worker; o estado segue disponível no app.
Os eventos correspondentes são preservados, não declarados entregues.

A limpeza tem fila durável, proteção de referências/uploads em andamento e margem
de 24 horas para reconciliação de órfãos. Não há expiração indiscriminada do bucket.
A exclusão de conta integra a remoção das referências elegíveis na mesma transação;
configuração real de S3/IAM e ativação dos jobs continuam como aceite externo.

## Conta e sessões — evidência local de 2026-09-07

Commits `645817d` e `c5dd340`: onboarding por nome, perfil/fuso, sessões,
revogação imediata do acesso, exportação JSON privada e exclusão com limpeza durável.
A revisão independente aprovou a correção de concorrência com criação de cobranças,
o tratamento de logout sem conexão e os ajustes visuais.

O gate completo passou no primeiro commit. Após a correção, passaram 55 testes
nativos de integração, 65 da API e 93 da web, além de tipos e lint focados.
Dois testes determinísticos reproduziram e eliminaram o deadlock entre exclusão
e criação. O smoke HTTP confirmou perfil, sessões, exportação e rejeição do mesmo
JWT após revogação. A metadata gerada declara `authorizerTTL: 0`; implantação real
do gateway não foi validada.

No navegador, o onboarding levou à timeline, perfil/fuso persistiram após reload,
fuso inválido preservou o rascunho com erro e a confirmação exigiu `EXCLUIR` completo.
A conferência pós-correção em 390 × 844 mostrou campos e ações de 48 px, sem overflow.
Não houve exclusão de conta pela UI nem conferência de arquivo exportado pelo
navegador; essas operações têm cobertura nativa/HTTP/componente, não esse aceite UI.
Os bancos descartáveis e servidores de QA foram removidos; dados normais preservados.

A exportação exige sessão ativa e autorização assinada de cinco minutos, sem arquivo
persistido no servidor. No mobile, compartilha texto JSON; salvar pelo sistema ainda
exige teste em dispositivo. Exclusão preserva fatos financeiros compartilhados com
identidade anonimizada; comprovantes anônimos ou de terceiros não são presumidos
propriedade do usuário excluído. A barreira transacional de exclusão pode fazer
gravações concorrentes aguardarem brevemente. Idioma/país seguem `pt-BR`/`BR`.
Revisão jurídica/contato do operador e provedores reais permanecem gates externos.

## Fechamento entre fluxos — evidência local de 2026-09-07

Endurecimento final: envelope de erro `{ code, message, correlationId }` com cópia
do cliente derivada apenas do `code` (texto do backend nunca é exibido); listener
de requisição que registra só correlação e status; quotas por IP confiável via
patches EZ4 pinados; busca de contatos e selo de vínculo (`hasAccount`); revogação
Apple na exclusão; OpenAPI gerada por reflexão e conferida por `openapi:check`;
smoke HTTP e specs de autenticação/pessoas migrados para a suíte `DatabaseTester`.

Gate completo em 2026-09-07, tudo verde: `pnpm verify` (lint, tipos, build web/Expo,
`expo-doctor` com apenas o aviso Hermes reconhecido), 70 testes em `common`, 75 na
API, 97 na web, 46 no mobile, 78 cenários nativos EZ4/PostgreSQL, smoke HTTP e
`openapi:check`. O `pnpm verify` anterior falhava porque o novo `app.config.js`
ignorava o `app.json` (agora estende o `config` recebido); o Docker falhava porque
a imagem não copiava `patches/` antes do `pnpm install`.

Docker: `docker build -f packages/web/Dockerfile` passou; o container respondeu
`/login` com 200 como UID 1001 e `/api/health` com 503 `unavailable` porque nenhum
backend foi apontado, comportamento esperado do BFF. Container descartável removido.

Testes ajustados ao contrato novo: componentes web/mobile passaram a mockar `code`
e a esperar a cópia do cliente; `ACCOUNT_DELETED` é importado da `common`; o spec
de quota de comprovantes agora exige que palpites inválidos consumam somente o
bucket do IP que os fez, e a exclusão concorrente compara `providerRevocation`
como conjunto. Abertos: dispositivos iOS/Android, EAS, provedores reais, auditoria
de teclado/foco/contraste e confronto automatizado OpenAPI × BFF/Expo.

## Smoke iOS — evidência local de 2026-09-07

Primeiro build nativo do projeto: Xcode 26.6, `expo run:ios` com
`RECEIVY_LOCAL_NATIVE=1` (bundle `dev.receivy.local`), simulador iPhone 17 Pro /
iOS 26.5, automação com Maestro (`packages/mobile/e2e/smoke`). Percurso aprovado:
código por e-mail (recuperado localmente pelo HMAC), onboarding de nome, timeline
vazia, criação de contato, cobrança de R$ 100,00 dividida em partes iguais com
detalhe em R$ 50,00, cadastro de chave Pix inline, publicação do link, retorno à
timeline com totais atualizados, telas de Ajustes (perfil, sessões, exportação,
exclusão), Chaves Pix e Recorrências.

O smoke encontrou e corrigiu dois defeitos exclusivos do nativo, invisíveis nos
testes Jest e no export web: (1) o `SafeAreaView` do safe-area-context ignorava
`className` do uniwind, deixando todas as telas em branco; agora há wrapper com
`withUniwind`, teste e regra de lint; (2) o Hermes não tem
`Intl.NumberFormat#formatToParts`, quebrando `formatMoney` na Home; o fallback
tem seis casos de regressão. Também foi preciso completar `local.env` (variáveis
de OAuth, link público e comprovantes) e resetar o schema do banco local, que só
tinha as tabelas de autenticação/contatos; os 500 dos jobs desapareceram após o
reset. Serviços e simulador descartáveis foram encerrados; o banco local foi
salvo antes do reset e continha apenas um usuário de QA.

Não exercitado no simulador: upload de comprovante pelo seletor de arquivos,
push real, Apple/Google reais, dispositivo físico e EAS.

## Smoke Android — evidência local de 2026-09-07

`expo run:android` (Gradle, 3m59s) instalou o APK de debug em um clone do AVD
Pixel 8 (API 34, arm64) criado só para QA porque o AVD original tinha 94% da
partição `/data` ocupada por outros apps; o clone `Receivy_QA` usa 12G e não
tocou nos dados do original. O mesmo percurso do iOS foi aprovado com os
fluxos de `packages/mobile/e2e/smoke`: login por código, onboarding, timeline
vazia, contato, cobrança R$ 100,00 → R$ 50,00, chave Pix inline, publicação
(o Android abriu o share sheet nativo com `http://localhost:3000/pay/<token>`),
totais na timeline, Ajustes, Chaves Pix e Recorrências.

Terceiro defeito nativo encontrado: o Hermes do Android implementa
`formatToParts`, mas lança "Cannot convert BigInt to number" ao receber
`bigint`; `formatMoney` agora só entrega `Number` ao Intl (exato até ~9e13),
com teste que intercepta o argumento. Aprendizados de automação: `hideKeyboard`
envia Back no Android e fecha o app na tela raiz; a variável inline
`EXPO_PUBLIC_*` não sobrepôs `.env.local`, resolvido com `adb reverse` das
portas 3735/3000/3736/8081. Emulador, Metro, API, web e storage local foram
encerrados ao final.

## Contrato OpenAPI × clientes e acessibilidade web — 2026-09-07

`openapi-contract.test.ts` lê `docs/openapi.json` (reflexão EZ4, conferida por
`openapi:check`) e prova três coisas: toda operação da API que o navegador precisa
passa pela allowlist do proxy financeiro ou por uma rota dedicada do BFF (seis
exclusões nomeadas: health, registro push, Apple nativo e callbacks de provedor);
nenhuma entrada da allowlist aponta para operação inexistente; e cada literal de
caminho dos clientes Expo (extraído do código-fonte, com expansão de templates
como `public-link${rotate ? "/rotate" : ""}`) existe na API, com paridade inversa
salvo `expenses/{id}` e `recurrences/{id}/preview`, deferidos no nativo e listados
no teste. Tudo passou em 2026-09-07.

`a11y.test.tsx` roda axe-core 4.13 em jsdom sobre login, timeline, contatos,
conta e nova cobrança (regras `region` e `color-contrast` desligadas: fragmentos
sem landmark e sem layout), verifica que Tab alcança e-mail e envio no login e
que a checkbox de contato responde a Espaço. Zero violações. O contraste vem dos
tokens em `packages/common/src/design/tokens.test.ts`: dez pares de texto ≥ 4,5:1
e o anel de foco ≥ 3:1 depois de trocar `accent` por `primary` no `:focus-visible`
(`accent` marcava 1,7:1). Duas lacunas ficam registradas como `it.fails`, para
decisão de marca: a borda de inputs `#BFC9C3` marca ~1,6:1 contra canvas/surface
(WCAG 1.4.11 pede 3:1) e `accent` não serve como indicador não-textual. As
larguras 390/768/1440 e o overflow seguem com inspeção manual por incremento; não
há teste de layout em jsdom.

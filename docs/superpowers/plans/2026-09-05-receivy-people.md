# Pessoas — incremento de implementação

Objetivo: cadastrar, editar, listar e arquivar contatos reais no web e Expo,
com isolamento por proprietário. Um contato aceita nome, um e-mail e um telefone
opcionais. Telefones são normalizados para E.164 brasileiro; e-mail segue a regra
existente. Contatos múltiplos por tipo não fazem parte deste primeiro formulário.

1. Contratos e validação compartilhados; testes de normalização e limites.
2. Tabelas `people` e `person_contacts`; índice de unicidade para e-mail ativo por
   proprietário; operações transacionais. Arquivar libera o e-mail sem apagar dados.
3. Endpoints protegidos e paginação; vínculo por e-mail confirmado no login,
   sem expor o identificador da conta vinculada nos DTOs.
4. BFF e formulário/lista responsivos; navegação e formulário/lista Expo.
5. Testes de isolamento, duplicação concorrente e preservação do histórico em
   Postgres local; tipos/lint/testes/build. Serviços locais são parados após a prova.

Critério de parada deste incremento: contatos utilizáveis nos dois clientes e
prova de autorização real. Cobranças, Pix, notificações e recorrências continuam
como incrementos seguintes. Google/Apple/e-mail permanecem habilitáveis conforme
a configuração de autenticação já implementada.

## Evidência — 2026-09-06

- `pnpm verify` terminou com código 0: 76 testes, lint, tipos e builds.
- Expo Doctor mantém somente a ressalva Hermes documentada do SDK 56.
- A prova local em Postgres cobriu isolamento, conflito concorrente, vínculo
  verificado, arquivamento idempotente e paginação (50 + 2 contatos).
- A conta descartável da inspeção visual e seus dados foram removidos.

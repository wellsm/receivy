# Roteiro de QA manual — fluxo completo com três contas

Data: 2026-09-11. Cobre web + API locais; o mobile espelha as mesmas telas (seção 16).
Marque cada passo, anote o observado quando divergir do esperado e mande o bloco
"Divergências" no fim.

## 0. Preparação

Contas (Mailpit aceita qualquer endereço):

| Papel | E-mail | Perfil do navegador |
|---|---|---|
| **Ana** — dona das contas | `ana@qa.local` | janela normal |
| **Bruno** — participante com conta | `bruno@qa.local` | janela anônima 1 |
| **Carla** — contato sem e-mail no início | (nenhum) → depois `carla@qa.local` | janela anônima 2 |

Subir:

```sh
cp packages/api/local.env.example packages/api/local.env       # se ainda não existe
cp packages/web/.env.example packages/web/.env.local            # idem
pnpm dev:api          # docker (pg + mailpit) + ez4 serve em :3735
pnpm dev:web          # http://localhost:3000
```

Banco zerado (opcional, apaga tudo local):

```sh
cd packages/api && node --env-file=local.env ./node_modules/@ez4/project/bin/cli.mjs serve -e local.env --local --reset
```

Checagens antes de começar:

- [ ] `curl -s http://localhost:3735/local-receivy-api/health` → `{"status":"ok",...}`
- [ ] Mailpit abre em <http://127.0.0.1:8025> (vazio ou com histórico antigo, tanto faz)
- [ ] `http://localhost:3000` redireciona para `/login`

## 1. Login por código — Ana

- [ ] `/login`, e-mail `ana@qa.local`, enviar. Esperado: vai para `/login/code`.
- [ ] Mailpit: chegou 1 e-mail com código de 6 dígitos.
- [ ] Digitar código errado 1×. Esperado: alerta "Código inválido ou expirado…", continua na tela.
- [ ] Voltar e pedir novo código em menos de 60 s. Esperado: **nenhum** e-mail novo (cooldown), tela segue normal (204 silencioso).
- [ ] Digitar o código certo. Esperado: entra em `/onboarding`.
- [ ] Anote: tempo entre pedir e receber o e-mail.

Limite de 5 tentativas erradas (opcional): errar 5× → o 6º, mesmo certo, é recusado.
Peça outro código depois de 60 s.

## 2. Onboarding — Ana

- [ ] Nome pré-preenchido vazio (conta nova). Preencher "Ana Souza", telefone opcional `(11) 99999-0001`.
- [ ] Salvar. Esperado: cai no feed (`/`) com "Sua timeline começa aqui".
- [ ] Recarregar `/onboarding` logada. Esperado: não reaparece (status já `active`).

## 3. Chaves Pix — Ana (`/settings/pix`)

- [ ] `Gerenciar chaves Pix` → `/settings/pix/new`. Cadastrar CPF `123.456.789-09`. Esperado: lista com a chave, marcada como padrão.
- [ ] Cadastrar telefone `(11) 99999-0001`. Esperado: salva como `+5511999990001`.
- [ ] Cadastrar o **mesmo CPF** de novo. Esperado: alerta "Esta chave Pix já foi cadastrada." (409, copy da API).
- [ ] Tornar o telefone padrão; arquivar o CPF. Esperado: lista reflete; arquivada some do padrão.
- [ ] Cadastrar CPF inválido `111.111.111-11`. Esperado: erro de validação sem sair da tela.

## 4. Contatos — Ana (`/contacts`)

- [ ] `Novo contato`: "Bruno Lima", `bruno@qa.local`. Esperado: aparece com selo "Ainda não entrou".
- [ ] `Novo contato`: "Carla Dias", **sem e-mail**. Esperado: aparece; abrir mostra que só recebe por link.
- [ ] Criar outro contato com `bruno@qa.local`. Esperado: "Já existe um contato ativo com esse e-mail." (409).
- [ ] Criar contato com `ana@qa.local`. Esperado: "Esse e-mail é o da sua própria conta." (409).
- [ ] Editar Carla: trocar apelido e nome. Esperado: salva (pendente é editável).
- [ ] Editar Bruno: remover o e-mail. Esperado: "O e-mail de um contato não pode ser removido, só corrigido." (400).
- [ ] Busca por "car". Esperado: só Carla.
- [ ] Abrir Bruno → ledger vazio ("Sem cobranças ativas").

## 5. Conta a receber, parcela única, dividida — Ana (`/billings/new`)

- [ ] Título "Jantar de sábado", 300,00, data de hoje, categoria `food`, "Receber via Pix" com a chave padrão.
- [ ] Divisão `equal` com Bruno + Carla + "Eu também participo". Esperado: 100,00 cada; cobrança da Ana marcada como liquidada no ciclo.
- [ ] Salvar. Esperado: `/billings/{id}` com 2 cobranças pendentes (Bruno, Carla) + a sua já liquidada.
- [ ] Recarregar e salvar o **mesmo formulário de novo** (voltar e reenviar). Esperado: não duplica (Idempotency-Key). Se a tela mandar chave nova, anote.
- [ ] Trocar a divisão para `fixed` 200/100 e salvar de novo com a mesma chave. Esperado: "Idempotency-Key já usada com outro conteúdo." (409) ou nova conta — anote qual.

Erros de formulário a provocar:

- [ ] Valor 0. Esperado: bloqueio no cliente ou "Confira os dados informados." (400).
- [ ] Divisão que não fecha (fixed 100 + 100 em 300). Esperado: mensagem de validação.

## 6. Cobrança do Bruno — link público e comprovante

Ainda como Ana:

- [ ] Abrir a cobrança do Bruno (`/charges/{id}`). Botões: `Compartilhar`, `Copiar Pix`, `Lembrar`, `Cancelar`.
- [ ] `Compartilhar` → gera link `http://localhost:3000/pay/<token>`. Copiar.

Janela anônima 2 (sem login):

- [ ] Abrir o link. Esperado: página pública com nome "Ana", descrição, valor, Pix copiável, botão de enviar comprovante.
- [ ] Enviar um `.txt` renomeado `.pdf`. Esperado: 422 "Envie um arquivo JPG, PNG ou PDF válido." (ou o cliente barra antes — anote).
- [ ] Enviar um PDF real (< 10 MB). Esperado: estado "em revisão"; a página faz polling e mostra o arquivo.
- [ ] Tentar enviar outro. Esperado: "Já existe um comprovante em revisão." (409).
- [ ] Apagar o comprovante (DELETE público) e enviar de novo. Esperado: aceito.

Como Ana:

- [ ] Cobrança mostra "Comprovante" pendente. Abrir `/charges/{id}/proof`. Esperado: visualiza o PDF.
- [ ] **Recusar** com motivo "Valor errado". Esperado: estado recusado; na página pública aparece o motivo e o botão "Substituir".
- [ ] Anônimo envia outro. Ana **aceita**. Esperado: cobrança vira paga; feed da Ana atualiza; evento no histórico.
- [ ] Ana tenta `Reabrir` uma cobrança paga por comprovante. Esperado: reabre (volta a pendente).
- [ ] `Reabrir` uma cobrança pendente (Carla). Esperado: "A cobrança não está paga." (409).

Link público:

- [ ] `Compartilhar` de novo → rotacionar. Esperado: link antigo dá 404 na página pública; novo funciona.
- [ ] Revogar (se a UI expõe). Esperado: 404 na página pública.

## 7. Convite para o rateio — Bruno entra pelo link

Como Ana, em `/billings/{id}`:

- [ ] `Convidar` → link `http://localhost:3000/join/<token>`. Copiar.

Janela anônima 1:

- [ ] Abrir o link deslogado. Esperado: cabeçalho da conta (nome da Ana, valor, modalidade, participantes) e botão `Participar` que leva ao login.
- [ ] Login como `bruno@qa.local` (código no Mailpit). Onboarding: nome já vem "Bruno Lima" (criado pelo contato). Salvar.
- [ ] Volta ao convite → `Participar`. Esperado: entra no rateio; a cobrança do Bruno agora é dele; abre `/charges/{id}`.
- [ ] Clicar `Participar` de novo. Esperado: idempotente (sem duplicar) ou "Divisão já em andamento." — anote qual.
- [ ] Feed do Bruno: cobrança "A pagar" 100,00 de Ana, com Pix da Ana copiável.

Como Ana:

- [ ] Ana abre o mesmo `/join/<token>` logada. Esperado: "Você é o dono desta cobrança." (409).
- [ ] Contato Bruno perdeu o selo "Ainda não entrou".

## 8. Convidado sem contato — placeholder da Carla

- [ ] Como Ana, gere um convite de uma **nova** conta a receber (ex.: "Cinema", 60,00, divisão equal só com Carla).
- [ ] Janela anônima 2: login como `carla@qa.local` (conta nova), onboarding "Carla Dias", abrir o `/join/<token>`, `Participar`.
- [ ] Esperado: Carla fica "aguardando" (não vira cobrança direto, porque o rateio tinha um placeholder sem e-mail).
- [ ] Como Ana, `/billings/{id}` mostra "Aguardando você" / "Entrou pelo link. Quem é essa pessoa?" com opções **vincular ao contato Carla**, **adicionar como novo**, **dispensar**.
- [ ] Escolher **vincular**. Esperado: contato Carla ganha o e-mail e o selo some; cobrança vai para a Carla real; placeholder some da agenda.
- [ ] Repetir com outro convite e escolher **dispensar**. Esperado: convidado some; sem cobrança.
- [ ] Tentar resolver de novo o mesmo convidado (F5 e clicar). Esperado: "Esse convidado já foi resolvido." (409).

## 9. Lembretes e notificações (e-mail via Mailpit)

Como Ana, numa cobrança pendente do Bruno:

- [ ] `Lembrar` → confirmar. Esperado: 202; Mailpit recebe e-mail para `bruno@qa.local` com o link público.
- [ ] `Lembrar` de novo. Esperado: "Já foi enviado um lembrete nas últimas 24 horas." (429).
- [ ] `Lembrar` numa cobrança da Carla **antes** de ela ter e-mail (se ainda houver uma). Esperado: sem canal → tela informa que ninguém pôde receber; cota não consumida.
- [ ] Pagar/cancelar a cobrança e tentar `Lembrar`. Esperado: "A cobrança já foi encerrada." (409).

Aviso inicial: ao criar uma conta com Bruno no rateio, Mailpit deve receber o aviso de nova cobrança para ele (push está `disabled` localmente, então cai no e-mail). Marque se chegou e quanto tempo depois.

## 10. Recorrência — `until` e `indefinite`

- [ ] Nova conta "Aluguel", `indefinite`, mensal, 1.000,00, divisão com Bruno, data de início hoje. Esperado: 1 ciclo gerado (o de hoje).
- [ ] `Projeção`. Esperado: lista dos próximos ciclos com datas/valores.
- [ ] Nova conta "Curso", `until`, mensal, 3 parcelas. Esperado: todas geradas? ou só a primeira? Anote.
- [ ] `Projeção` em "Curso". Esperado: "Só cobranças sem fim têm projeção." (409).
- [ ] Editar "Aluguel": trocar valor. Esperado: só ciclos futuros mudam; o de hoje continua (snapshot).
- [ ] Editar "Aluguel": trocar data de início para o passado. Esperado: "Contas já geradas são snapshot: só lembretes, Pix e encerramento podem mudar." (409) ou bloqueio na UI.
- [ ] Pausar "Aluguel" e tentar pausar "Curso". Esperado: pausa OK; "Só contas sem fim podem ser pausadas." (409).
- [ ] `Encerrar` "Curso". Depois `Editar`. Esperado: "Conta encerrada não aceita edição." (409).

A materialização dos ciclos seguintes roda no `BillingCron` às 05:00 UTC; não dá para ver ao vivo. Se quiser forçar, avise que eu preparo um script.

## 11. Conta a pagar — Ana deve para Carla

- [ ] `/billings/new`, direção "A pagar", "Para quem": Carla, 80,00, chave Pix **digitada** `(21) 98888-0002` (telefone).
- [ ] Salvar. Esperado: cobrança "A pagar" no feed da Ana com Pix `+5521988880002`; sem `Convidar` e sem link público.
- [ ] Tentar informar divisão numa conta a pagar. Esperado: "Uma conta a pagar não tem divisão nem chave da sua carteira." (409) ou campo escondido.
- [ ] Carla (logada) vê a cobrança como "A receber" no feed dela; consegue marcar como paga / revisar comprovante da Ana? Anote o que a UI oferece.
- [ ] Ana envia comprovante pela própria tela `/charges/{id}`. Carla aceita. Esperado: paga.

## 12. Feed, filtros e ledger

- [ ] Feed da Ana: filtros "A receber" / "A pagar", status, tipo, período. Trocar rápido entre eles. Esperado: resultado bate com o último filtro clicado.
- [ ] "Carregar mais" com mais de uma página (crie ~25 cobranças se quiser testar; senão pule).
- [ ] `/contacts/{id}` do Bruno: ledger com pendentes, concluídas e saldo.
- [ ] `Cobrar` a partir do ledger. Esperado: abre `/billings/new` com Bruno pré-selecionado.
- [ ] `Remover` contato Bruno. Esperado: "Contato removido", histórico preservado; Bruno some da lista ativa; busca com "arquivados" mostra.

## 13. Cotas e envelope (curl, opcional)

```sh
API=http://localhost:3735/local-receivy-api
TOKEN=<token de um link /pay/ válido>
for i in $(seq 1 61); do curl -s -o /dev/null -w "%{http_code} " $API/public/charges/$TOKEN; done; echo
# esperado: 60× 200 e depois 429
curl -s $API/public/charges/$TOKEN | head -c 300; echo
# esperado no 429: {"type":"error","message":"Muitas tentativas...","context":{"code":"RATE_LIMITED"}}
curl -s -o /dev/null -w "%{http_code}\n" $API/public/charges/forged.1.abc      # 404
curl -s $API/auth/email/code -H 'content-type: application/json' -d '{"email":"x"}' # 400 com details do schema
```

## 14. Sessão e conta

- [ ] Ana: `Sair da conta`. Esperado: `/login`; voltar com F5 não reentra.
- [ ] Login de novo; abrir em duas abas; sair numa. Esperado: a outra cai no próximo request.
- [ ] Bruno: `Excluir conta` sem digitar `EXCLUIR`. Esperado: "Confirme digitando EXCLUIR." (400).
- [ ] Bruno: excluir com `EXCLUIR`. Esperado: sai; login com `bruno@qa.local` cria conta nova e vazia.
- [ ] Ana: ledger/cobranças que envolviam Bruno. Esperado: histórico preservado com nome anonimizado ou "Contato removido" — anote o que aparece.

## 15. Legal e público

- [ ] `/terms` e `/privacy` abrem sem login e mostram o contato do operador (`NEXT_PUBLIC_OPERATOR_CONTACT`, vazio localmente).
- [ ] `/join/<token expirado ou revogado>`. Esperado: "Convite indisponível".

## 16. Mobile (opcional, mesmas telas)

`pnpm dev:mobile` com dev client. Rodar 1, 2, 3, 4, 5, 6 (envio de comprovante pela tela `charges/[id]/proof`), 9 e 14. Diferenças esperadas: tabs nativas no iOS, header vindo do router, pull-to-refresh nas listas. Push continua `disabled` localmente.

## 17. Mês materializado

- [ ] Criar recorrente mensal com vencimento daqui a alguns dias neste mês. Esperado: a cobrança aparece no Feed e no detalhe na hora; nenhum e-mail/push agora; o lembrete chega às 06:00 do dia.
- [ ] Criar recorrente com vencimento hoje. Esperado: aviso inicial imediato.
- [ ] Criar parcelado 3× começando hoje. Esperado: 3 cobranças, 1 aviso (a de hoje).
- [ ] Pausar com pendentes → modal "Pausar conta?". "Manter as deste mês": a cobrança do mês continua pendente. Repetir em outra conta com "Cancelar pendentes (N)": todas canceladas.
- [ ] Encerrar parcelado com "Manter as deste mês". Esperado: parcela do mês pendente, meses seguintes canceladas.
- [ ] Pausar/Encerrar sem pendentes. Esperado: Pausar direto; Encerrar com a confirmação simples.
- [ ] Editar valor de recorrente com cobrança futura no mês → "Aplicar também às deste mês". Esperado: mesma cobrança (mesmo link público) com o novo valor. Repetir com "Só a partir do mês seguinte": valor do mês intacto.
- [ ] Editar só a categoria. Esperado: salva sem modal.
- [ ] Trocar o vencimento de 15 para 30 no dia 16 de um mês que já tem a cobrança de 15. Esperado: nenhuma segunda cobrança no mês; próxima em 30 do mês seguinte.

## 18. Dark mode

- [ ] Web, Perfil › Aparência em Sistema com o sistema no escuro: Feed, Contas, detalhe da conta, cobrança e Perfil escuros, sem flash claro ao recarregar.
- [ ] Web, trocar para Claro e depois Escuro: aplica na hora e sobrevive ao recarregar a página.
- [ ] Web, modais (Pausar/Encerrar, edição com escopo, sair, excluir conta): fundo escurecido e textos legíveis nos dois temas.
- [ ] Web, selos Atrasada, Em análise, Paga e Lembrete: cores de status legíveis no escuro.
- [ ] Mobile (após rebuild), Sistema: acompanha o modo do aparelho ao trocar pela central de controle.
- [ ] Mobile, Escuro fixado com o aparelho no claro: StatusBar clara, header e abas escuros, alertas nativos e date picker escuros.
- [ ] Mobile, fechar e reabrir o app com Escuro fixado: abre direto escuro, sem flash.
- [ ] Mobile iOS (NativeTabs) e Android (Tabs): ícones ativo e inativo legíveis nos dois temas.

## Divergências

Copie um bloco por item:

```
Fluxo: <nº e passo>
Esperado: <do roteiro>
Observado: <o que aconteceu, com a mensagem exata>
Como reproduzir: <cliques / curl>
Print/log: <se tiver>
```

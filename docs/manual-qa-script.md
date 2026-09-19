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

## 3. Meios de pagamento — Ana (`/settings/payment-methods`)

- [ ] `Gerenciar meios de pagamento` → `Cadastrar Novo Meio` → `/settings/payment-methods/new`. Tipo `Pix`, cadastrar CPF `123.456.789-09`. Esperado: lista com o meio, selo "Padrão".
- [ ] Cadastrar telefone `(11) 99999-0001`. Esperado: salva como `+5511999990001`.
- [ ] Cadastrar o **mesmo CPF** de novo. Esperado: alerta "Esse meio de pagamento já está cadastrado." (409, copy da API).
- [ ] Tornar o telefone padrão; excluir o CPF (lixeira → confirmar "Excluir meio de pagamento?"). Esperado: lista reflete; "Meio de pagamento excluído."; CPF sai da lista.
- [ ] Cadastrar CPF inválido `111.111.111-11`. Esperado: "Chave Pix inválida." sem sair da tela.

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

- [ ] Título "Jantar de sábado", 300,00, data de hoje, categoria `food`, "Selecionar meio de pagamento" com o meio padrão.
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

Pagamento informado sem comprovante:

- [ ] Nova cobrança para o Bruno. Janela anônima: abrir o link e tocar em "Já paguei e não tenho comprovante". Esperado: "Pagamento informado · aguardando confirmação de Ana"; dropzone continua disponível.
- [ ] Como Ana: feed mostra "Em análise" e o selo "Pagamento informado", sem "Lembrar". `Lembrar` via curl devolve 409 `CHARGE_IN_REVIEW`.
- [ ] Ana abre a cobrança: "Bruno informou que pagou…". Tocar "Não recebi" com motivo "Não caiu". Esperado: volta a pendente; a página pública mostra "Pagamento não identificado: Não caiu."
- [ ] Anônimo informa de novo e anexa um PDF. Esperado: vira "Comprovante enviado"; Ana confirma e a cobrança fica paga (`charge.paid { via: 'proof' }`).
- [ ] Conta a pagar da Ana para a Carla (Carla com conta ativa): "Marcar pago" abre "Marcar como pago?" e deixa em análise; Carla confirma no app dela. Com recebedor que nunca entrou, "Marcar pago" marca paga direto.

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
- [ ] Web, Sistema com o Feed aberto: trocar o modo do sistema aplica na hora, sem recarregar.
- [ ] Web, trocar para Claro e depois Escuro: aplica na hora e sobrevive ao recarregar a página.
- [ ] Web, modais (Pausar/Encerrar, edição com escopo, sair, excluir conta): fundo escurecido e textos legíveis nos dois temas.
- [ ] Web, selos Atrasada, Em análise, Paga e Lembrete: cores de status legíveis no escuro.
- [ ] Mobile (após rebuild), Sistema: acompanha o modo do aparelho ao trocar pela central de controle.
- [ ] Mobile, Escuro fixado com o aparelho no claro: StatusBar clara, header e abas escuros, alertas nativos e date picker escuros.
- [ ] Mobile, fechar e reabrir o app com Escuro fixado: abre direto escuro, sem flash.
- [ ] Mobile iOS (NativeTabs) e Android (Tabs): ícones ativo e inativo legíveis nos dois temas.

## 19. Categorias e foto de perfil

- [ ] Web e mobile, nova conta: Saúde, Educação e Lazer aparecem antes de Outro, com ícone e cor próprios; salvar com Saúde funciona (exige `ez4 serve --local` ou deploy com a restrição atualizada).
- [ ] Web, Perfil › lápis no meio da foto: escolher JPG, PNG ou HEIC (Safari); spinner durante o envio; a foto aparece recortada em círculo.
- [ ] Web, trocar de novo: a foto nova substitui a anterior (mesma chave `avatars/<id>` no bucket).
- [ ] Mobile (após rebuild), Perfil › lápis: galeria abre com recorte quadrado; cancelar não muda nada; a foto aparece.
- [ ] Outra conta que cobra ou paga essa pessoa: a foto aparece no Feed, no detalhe da cobrança, no detalhe da conta (participantes, recebedor, links), em Contatos, no extrato do contato, no seletor de contatos e na divisão.
- [ ] Pessoa sem foto: continua com a inicial em todos esses lugares.
- [ ] Primeiro login com Google numa conta nova: a foto do Google vira a foto do perfil. Login posterior com Google numa conta que já tem foto: a foto enviada continua.
- [ ] `/pay/<token>`: continua sem foto.
- [ ] Mobile, cobrança vista por quem deve, com credor sem foto: aparece a inicial do credor, nunca a própria foto.
- [ ] Mobile Android, foto grande da galeria: o envio aceita ou mostra "Envie uma imagem JPG ou PNG de até 2 MB."; a foto carrega sem demora para a outra pessoa.
- [ ] Excluir a conta: o objeto `avatars/<id>` some do bucket.

## 20. Sem avisos

Como Ana, com Bruno e Carla na agenda (vencimento hoje, para o aviso inicial sair na hora):

- [ ] Nova conta a receber com Bruno e Carla. Ligar "Não notificar" do Bruno; aparece "Sem avisos automáticos para esta pessoa. Você ainda pode lembrar manualmente." Criar. Esperado: só a Carla recebe o aviso inicial no Mailpit; a cobrança do Bruno fica sem `notice.sent`.
- [ ] Detalhe da conta: a linha do Bruno mostra o selo "Sem avisos"; a da Carla não.
- [ ] "Não notificar" na linha da Carla. Esperado: confirmação "Não notificar Carla?" com "Os lembretes automáticos das cobranças pendentes e futuras de Carla nesta conta param."; confirmar mostra o selo e grava `billing.participant_silenced { userId }`.
- [ ] "Voltar a notificar" na linha da Carla. Esperado: sem confirmação; aviso "Avisos reativados para Carla."; o selo some.
- [ ] Abrir a cobrança do Bruno: selo "Sem avisos" junto ao status e "Voltar a notificar" nas ações da cobrança; "Lembrar" continua igual. Tocar. Esperado: "Avisos reativados."; o selo some só nessa cobrança (no detalhe da conta, a linha dessa cobrança perde o selo e a ação do Bruno continua "Voltar a notificar").
- [ ] "Não notificar esta cobrança" na mesma cobrança. Esperado: "Avisos desta cobrança pausados."
- [ ] `Lembrar` na cobrança silenciada. Esperado: o lembrete manual chega no Mailpit.
- [ ] Conta recorrente com o Bruno silenciado: editar, desligar a chave dele e salvar. Esperado: as pendentes do Bruno perdem o selo; o evento `billing.participant_unsilenced` aparece.
- [ ] Como Bruno (login dele): a cobrança não mostra "Sem avisos" em lugar nenhum.
- [ ] Conta a pagar: `curl -X PUT <api>/charges/<id>/notify -H 'content-type: application/json' -d '{"notify":false}'` com o token da Ana. Esperado: 409 `SILENCE_UNAVAILABLE`.
- [ ] Mobile: os mesmos passos no formulário, no detalhe da conta (a confirmação é o alerta nativo) e na cobrança.

## 21. Registros

Como Ana:

- [ ] Nova conta, "Vou receber", ligar "Já recebi". Esperado: somem Participantes, Divisão da Conta e "Selecionar meio de pagamento"; aparecem "De quem" (placeholder "Ex.: Empresa X") e "Registro já quitado: ninguém recebe aviso. Cada ocorrência fica paga no vencimento."
- [ ] Salário recorrente: "Recorrente", mensal, vencimento hoje, categoria "Salário e renda", "De quem" = "Empresa X". Criar. Esperado: a cobrança de hoje nasce paga; o feed mostra "Salário · Empresa X" com o selo "Registro"; "Recebido" do mês soma o valor; nada chega no Mailpit.
- [ ] Recorrente com data anterior a hoje: no web o calendário não deixa escolher (data mínima hoje); no mobile, digitar a data de ontem e criar. Esperado: "Registro recorrente começa hoje ou depois."
- [ ] Avulso no passado: "Vou pagar", "Já paguei", "Para quem" = "Imobiliária", "À vista", vencimento no mês passado. Criar. Esperado: nasce paga, com `charge.paid { via: 'registered' }` e `paid_at` no início do dia do vencimento; "Pago" do mês passado soma o valor.
- [ ] Lista de contas: o salário mostra os selos "Registro" e "Empresa X" no lugar de "N pessoas"; o avulso mostra "Registro", "A pagar" e "Imobiliária".
- [ ] Detalhe da conta do salário: chip "Registro", linha "De Empresa X", seção "Cobranças", sem "Convidar" e sem compartilhar link.
- [ ] Detalhe da cobrança do salário: selo "Registro" junto ao status; sem "Lembrar", "Compartilhar", comprovante e "Não notificar"; "Reabrir" disponível.
- [ ] Reabrir a cobrança. Esperado: fica pendente e o cron do dia seguinte não a quita de novo (nenhum `charge.paid` novo); "Marcar como pago" quita de novo.
- [ ] Lembrar bloqueado: `curl -X POST <api>/charges/<id>/reminders` com o token da Ana, na cobrança reaberta. Esperado: 409 `SETTLED_NO_REMINDERS`.
- [ ] Editar o salário: "Já recebi" aparece travado com "Não dá para mudar depois de criada."; trocar "De quem" para "Empresa Y" e salvar. Esperado: feed e detalhes mostram "Empresa Y".
- [ ] `curl -X PATCH <api>/billings/<id> -H 'content-type: application/json' -d '{"settled":false}'` com o token da Ana. Esperado: 409 `SETTLED_LOCKED`.
- [ ] Mobile: os mesmos passos no formulário (chave nativa), no detalhe da conta e na cobrança.

## 22. Meios de pagamento / InfinitePay

Local (`PAYMENT_METHOD_LINK=fake` no `packages/api/local.env`):

- [ ] Como Ana, `/settings/payment-methods/new`, tipo `InfinitePay`, InfiniteTag `$qualquer`. Salvar. Esperado: aparece na lista dos meios ativos.
- [ ] Nova conta a receber com Bruno usando esse meio. Abrir o detalhe da cobrança do Bruno. Esperado: tile `Copiar link de pagamento` (não `Copiar Chave Pix`).
- [ ] Janela anônima, como Bruno (pagador): abrir o link público, tocar `Pagar`. Esperado: abre `/dev/checkout/infinitepay/<orderNsu>` (só existe em dev) com o botão `Simular pagamento`.
- [ ] `Simular pagamento`. Esperado: volta para `/pay/<token>?order_nsu=…&transaction_nsu=…&slug=…`, o `provider-return` da API fecha a cobrança e a página mostra confirmação (`Ver comprovante da InfinitePay`); Ana recebe o push "Pagamento confirmado".

Um handle real só é exercitado com `PAYMENT_METHOD_LINK=live` (pode ser em `dev`, se o dono já ativou lá):

- [ ] Cadastrar um InfiniteTag **sem** o checkout externo ativado no app InfinitePay. Esperado: 422 com o botão `Abrir configurações da InfinitePay`.
- [ ] Ativar o checkout externo no app InfinitePay, cadastrar o mesmo handle de novo. Esperado: salva.
- [ ] Criar uma cobrança de R$ 1,00 com esse meio; pagar de verdade pelo link (Pix ou cartão). Esperado: webhook chega, evento `charge.paid { via: 'provider' }` na timeline de eventos, recibo (`Ver comprovante da InfinitePay`) visível para o dono e o pagador.

Cobrança já cancelada:

- [ ] Cancelar uma cobrança InfinitePay pendente. Pagar pelo link antigo (guardado antes de cancelar) mesmo assim. Esperado: cobrança segue `Cancelada` (não reabre), evento `charge.provider.ignored` na timeline, Ana recebe o push de aviso.

## 23. Meios de pagamento / PagBank

Local (`PAYMENT_METHOD_LINK=fake` e `PAYMENT_CREDENTIAL_KEY_B64` preenchidos no `packages/api/local.env`):

- [ ] Como Ana, `/settings/payment-methods/new`, tipo `PagBank`, qualquer token, rótulo `Loja`. Salvar. Esperado: aparece na lista sem o botão `Copiar valor`; na tabela `integrations` há uma linha `pagseguro` de Ana com `credentials.ciphertext` começando por `v1.` (o token nunca aparece em claro).
- [ ] Nova conta a receber com Bruno usando esse meio. Abrir o detalhe da cobrança. Esperado: tile `Copiar link de pagamento`; o rodapé do e-mail diz "O pagamento acontece pelo link do PagBank de quem cobra.".
- [ ] Janela anônima, como Bruno: abrir o link público, tocar `Pagar`. Esperado: abre `/dev/checkout/pagseguro/<orderNsu>` com o botão `Simular pagamento`.
- [ ] `Simular pagamento`. Esperado: volta para `/pay/<token>?returned=1` já com "Pagamento confirmado" (a rota fake da API liquidou antes do redirect); evento `charge.paid { provider: 'pagseguro' }` na timeline; Ana recebe o push "Pagamento confirmado".
- [ ] Recarregar a página pública. Esperado: continua `Paga`, sem novo evento (replay ignorado).
- [ ] Criar uma segunda cobrança PagBank e cancelá-la pelo detalhe. Esperado: evento `charge.payment_link.inactivated` na timeline; abrir o link antigo mostra a cobrança cancelada, sem `Pagar`.

Token real só com `PAYMENT_METHOD_LINK=sandbox` (dev) e um token de sandbox do PagBank:

- [ ] Cadastrar PagBank com um token inválido. Esperado: 422 `Token inválido ou sem permissão.`, nenhuma integração salva. Repetir 11 vezes seguidas: a 11ª responde 429 (cota `pagseguro-verify`).
- [ ] Cadastrar com o token de sandbox válido. Esperado: salva.
- [ ] Criar uma cobrança de R$ 1,00 com esse meio; abrir `Pagar` (checkout sandbox do PagBank, Pix ou cartão de teste) e pagar. Esperado: o retorno cai em `/pay/<token>?returned=1` com o aviso "Pagamento em confirmação" que se recarrega sozinho; ao chegar o webhook, evento `charge.paid { provider: 'pagseguro' }`, página `Paga`, push para Ana.
- [ ] Editar o meio sem informar token (placeholder `•••••• (mantido)`), só o rótulo. Esperado: salva sem revalidar; cobranças novas continuam ganhando link.

Credencial revogada:

- [ ] Arquivar o meio PagBank (o único de Ana). Esperado: `integrations.revoked_at` preenchido. Criar uma cobrança nova que ainda aponte para esse meio (via edição de uma conta existente) — esperado: `payment_link_state = failed`, evento `charge.payment_link.failed { reason: 'no_credential' }`, e-mail sem link.
- [ ] Com dois meios PagBank cadastrados, arquivar um. Esperado: a integração segue ativa (o outro meio ainda a usa); só o arquivamento do último revoga.

## 24. Plano pago (API e UI)

Local (`PLAN_BILLING=fake` no `packages/api/local.env`):

- [ ] Como Ana (plano Grátis), criar 5 cobranças indefinidas. Esperado: as 5 salvam.
- [ ] Criar uma 6ª cobrança indefinida. Esperado: 402 `PLAN_LIMIT_REACHED` com o paywall.
- [ ] `POST /plan/subscribe`. Esperado: assina em processo (sem cartão), plano vira Básico.
- [ ] Cadastrar um meio InfinitePay. Esperado: salva (antes do plano Básico, respondia 402 `PLAN_REQUIRED`).

Dev (`PLAN_BILLING=live` no `packages/api/dev.env`), com `stripe listen --forward-to <api>/webhooks/stripe` rodando:

- [ ] Assinar pelo web com o cartão de teste `4242 4242 4242 4242`. Esperado: evento `plan.subscribed` na timeline da conta.
- [ ] Cancelar a assinatura no dashboard do Stripe. Esperado: evento `plan.canceled` na timeline da conta; billings em excesso ou com link de pagamento pausadas com evento `billing.paused { reason: 'plan' }`.
- [ ] Reenviar o mesmo evento (`stripe events resend <event-id>`). Esperado: nenhum segundo downgrade (evento `plan.canceled` continua único na timeline).

Web local (`PLAN_BILLING=fake`, sem `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`):

- [ ] Abrir `/settings/plan` como Ana (plano Grátis). Esperado: mostra Grátis, a barra de uso e a mensagem "Assinaturas indisponíveis neste ambiente." (sem botão "Assinar o Básico").
- [ ] Com as 5 cobranças indefinidas já usadas, criar uma 6ª em `/billings/new`. Esperado: abre o paywall "Plano Básico" com a mensagem vinda da API.
- [ ] Em `/settings/payment-methods`, abrir o chip InfinitePay com cadeado. Esperado: abre o mesmo paywall "Plano Básico".

Web dev (`PLAN_BILLING=live`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` preenchida, `stripe listen --forward-to <api>/webhooks/stripe` rodando):

- [ ] Em `/settings/plan`, clicar "Assinar o Básico". Esperado: abre o Payment Element inline.
- [ ] Preencher o cartão `4242 4242 4242 4242` e confirmar. Esperado: mostra "Confirmando pagamento…" e, em até 30 s, "Plano Básico ativo".
- [ ] Repetir a assinatura (conta nova) com o cartão `4000 0000 0000 0002`. Esperado: alerta de recusa do Stripe no próprio Payment Element; o formulário continua na tela.
- [ ] Com o plano Básico ativo, clicar "Trocar cartão". Esperado: abre o Payment Element em modo setup e troca o cartão salvo.
- [ ] Clicar "Cancelar ao fim do período". Esperado: o botão vira "Retomar" e aparece "Cancela em …" com a data.
- [ ] Clicar "Retomar". Esperado: volta a "Cancelar ao fim do período" e some o "Cancela em …".
- [ ] Com pelo menos uma fatura paga, conferir a lista "Faturas". Esperado: cada linha mostra a data, o valor e um link "PDF".

Mobile (leitura, mesmo ambiente do web dev):

- [ ] Abrir o Perfil. Esperado: card "Plano Grátis" (ou "Plano Básico", conforme o plano) com o uso de cobranças indefinidas e a nota "Gerencie seu plano no site.".
- [ ] No Perfil → Meios de pagamento, tocar no chip InfinitePay com o plano Grátis. Esperado: mensagem "Limite do plano grátis. Gerencie seu plano no site.", sem botão nem link.
- [ ] Com as 5 cobranças indefinidas usadas, tentar criar a 6ª. Esperado: mostra a mensagem de limite com o sufixo "Gerencie seu plano no site.", sem botão de ação.

## Divergências

Copie um bloco por item:

```
Fluxo: <nº e passo>
Esperado: <do roteiro>
Observado: <o que aconteceu, com a mensagem exata>
Como reproduzir: <cliques / curl>
Print/log: <se tiver>
```

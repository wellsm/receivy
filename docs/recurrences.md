# Recorrências

Uma recorrência é uma regra do proprietário. Mensais limitam dias 29–31 ao último
dia do mês; anuais em 29/2 usam 28/2 quando necessário. O calendário usa o fuso
IANA salvo na regra, inicialmente carregado do perfil nos clientes.

## Início, pausa, edição e falhas do agendador

- Na criação, início omitido significa hoje no fuso da regra. Um início explícito
  anterior a hoje é rejeitado. O cadastro não cria dívida anterior à ativação.
- Pausar suspende novas materializações. Reativar pula ocorrências ainda não
  materializadas com vencimento anterior ao dia local da reativação. Cobranças
  já criadas permanecem intactas, inclusive as antecipadas por lembretes.
- Encerrar é terminal: impede futuras materializações, sem cancelar cobranças.
- Editar afeta apenas ocorrências não materializadas. O início original no
  passado pode permanecer; trocar por outro início já passado é rejeitado.
- Uma interrupção do agendador enquanto a regra esteve ativa não apaga dívida:
  o cursor persistido mantém o atraso para as próximas execuções. Cada execução
  examina no máximo 100 ocorrências, globalmente, e continua na próxima hora.
  Esse limite não é um prazo de retenção: backlog ativo antigo é preservado.
  Tentativas que falham também consomem o limite de 100. A execução visita uma
  ocorrência por regra por rodada; regras nunca tentadas ou menos recentemente
  tentadas têm prioridade. Uma regra que falha não é repetida nessa execução.
  `last_attempted_at` é metadado operacional opcional, compatível com regras
  anteriores; falhas o atualizam sem avançar o cursor financeiro. Sob locks,
  uma execução antiga nunca regride a data de tentativa de outra mais recente.
- Uma edição pode antecipar um vencimento que ainda não foi materializado.
  Por isso um cursor que avançou no futuro por lembrete é recuado até ontem;
  ocorrências já materializadas continuam excluídas pela chave única.

O intervalo de início/fim é inclusivo. Fim preenchido limita os vencimentos;
um último lembrete pode ocorrer depois do fim. A regra pode continuar marcada
ativa, sem próxima ocorrência, até seu proprietário encerrá-la.

## Materialização e entrega

Lembretes padrão: -3, 0 e +2 dias; cada um pode ser desabilitado. São aceitos até
10 offsets únicos entre -90 e +90. A cobrança é materializada na data do primeiro
lembrete habilitado (inclusive se ele for após o vencimento); sem lembretes
habilitados, no vencimento. O canal `auto` reserva o roteamento push disponível,
e-mail como alternativa e compartilhamento manual quando nenhum está disponível.

`RecurrenceScheduler` usa EZ4 0.52.0, `cron(0 * * * ? *)`, timezone `UTC`, timeout
300 s e 3 retries. A cadência UTC só dispara a avaliação; cada regra calcula seu
dia local. Nenhum deploy ou agendamento cloud foi executado neste trabalho.
O runner `ez4 test --local` suprime o disparo automático do agendador.

Ordem de locks: usuário proprietário → regra → pessoas → Pix, igual à criação de
despesas. Cada transação grava a ocorrência única `(recurrence_id, occurrence_date)`,
cobranças snapshot, auditoria e outbox. A regra e seu cursor são bloqueados;
replays concorrentes não duplicam cobranças. A criação das cobranças reutiliza
`prepareChargeMaterialization` / `persistChargePlan`, que já emitem `charge.created`.

`recurrence_occurrences` preserva `reminders_json` e `timezone`; cobranças referem
`source=recurrence`, `source_id` e `source_occurrence_id`. Um único evento
`recurrence.materialized` por ocorrência carrega `recurrenceId`, `occurrenceId`,
`dueDate`, `timezone` e `reminders`. A entrega pertence ao próximo módulo; este
job não envia e-mail/push nem cria links públicos automaticamente.

Contato/Pix arquivado deixa a regra pendente para correção do proprietário;
o cursor não avança e o handler registra IDs de regras afetadas, sem dados do
contato. Outras regras continuam processadas.

## API e clientes

Rotas autenticadas: `GET/POST /recurrences`, `GET/PATCH /recurrences/{id}`,
`GET /recurrences/{id}/preview`, `POST /recurrences/{id}/pause`, `/reactivate`,
`/end`. Criação exige `Idempotency-Key`; conteúdo diferente na mesma chave
retorna conflito. Edição substitui a regra futura completa.

Lista/detalhe incluem próxima materialização e simulação de hoje até +90 dias.
Timeline mescla cobranças e projeções com cursor de data/ID; comprovantes e
pagamentos continuam agrupados com sua cobrança. Projeções são visíveis apenas
ao dono, têm direção `receivable`, não entram no saldo e não oferecem pagamento,
comprovante ou compartilhamento. Após materialização não coexistem com a mesma
ocorrência virtual.

Web usa a rota BFF financeira existente, cookies e validação de origem; mobile
usa o cliente autenticado existente. `/recurrences` em ambos oferece lista,
detalhe e editor com rateio exato e confirmação de encerramento. Salvar com
resposta incerta congela corpo/chave para retry; rejeição definitiva libera o
rascunho. Nenhum componente UI é compartilhado entre web e nativo.

## Verificação local

```sh
pnpm --filter @receivy/common test
pnpm --filter @receivy/api check-types:test
pnpm --filter @receivy/api test:integration
pnpm --filter @receivy/api test:http-smoke
pnpm --filter @receivy/web test
pnpm --filter @receivy/mobile test
```

Os testes de banco usam `DatabaseTester`, `node:test/assert`, fixtures UUID e o
banco dedicado `receivy_tests`; incluem invocação do handler horário real.
O smoke HTTP complementar cria/remove um banco tmpfs isolado e verifica a
serialização real EZ4 de criação/leitura, sem substituir os testes de negócio.
Exportar Expo web não é teste de dispositivo iOS/Android. Screenshots/QA de
navegador, dispositivos físicos e cloud devem ser verificados separadamente.

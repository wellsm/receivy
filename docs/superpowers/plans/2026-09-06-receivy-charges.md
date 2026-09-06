# Cobranças — sequência de implementação

Base: conceito aprovado em `../specs/2026-09-04-receivy-mvp-design.md`.

1. Núcleo compartilhado de rateio fixo/igual/percentual, com inteiros seguros e
   distribuição de resíduos por ordem estável. Resolver a participação total
   antes de parcelar; a parte do dono não gera cobrança. Provar conservação dos
   centavos e rejeição de entradas inválidas antes de ligar a persistência.
2. Datas mensais com ajuste ao último dia do mês, preservando o dia original.
3. Criação transacional de despesas, alocações e cobranças snapshot na API,
   validando propriedade dos contatos e idempotência contra reenvios.
4. BFF e revisão/criação web; depois o mesmo fluxo no Expo.
5. Prova de isolamento e persistência no Postgres; tipos, testes e builds.

Não incluir pagamento automático, parcelas parciais ou recorrências neste fluxo.
O núcleo sozinho não constitui entrega do fluxo de criação de cobranças.

## Progresso — 2026-09-06

Etapas 1 e 2 implementadas em `packages/common`: rateio e planejamento de
cobranças por parcela, sem gerar cobrança para o dono nem para parcelas zeradas.
Datas são calculadas como calendário puro, sem conversões dependentes do timezone
do processo. Os cálculos intermediários usam BigInt; os DTOs retornam números
inteiros seguros. Limites defensivos: 100 participantes e 360 parcelas.

`pnpm verify` passou com 91 testes, lint, tipos e builds; permanece a advertência
Hermes já documentada do SDK 56. Os 15 testes novos cobrem conservação dos totais,
resíduos estáveis, precisão, validação, anos bissextos e virada de ano.

Próximo passo: etapa 3. Nenhuma despesa/cobrança financeira é persistida ainda.

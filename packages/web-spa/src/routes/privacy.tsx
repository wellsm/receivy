import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@/components/ui/link";
import { readEnv } from "@/lib/env";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacidade | Receivy" }] }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 leading-7 text-ink">
      <h1 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-primary-strong">Privacidade</h1>
      <p className="m-0 leading-7 text-muted">Tratamos e-mail verificado, nome, sessões, contatos cadastrados, registros financeiros manuais e comprovantes para organizar seus registros. Tokens de dispositivos permitem avisos por push quando o sistema autoriza notificações. Não acessamos contas bancárias.</p>
      <p className="m-0 leading-7 text-muted">Credor e devedor têm acesso somente aos registros autorizados. Um link público mostra dados mínimos da cobrança e a chave Pix aplicável; qualquer pessoa com o link pode acessá-lo enquanto válido. Não compartilhe o link publicamente.</p>
      <p className="m-0 leading-7 text-muted">Você pode sair da conta e solicitar exclusão em Perfil.</p>
      <p className="m-0 leading-7 text-muted">Na exclusão, revogamos sessões e links afetados, removemos identificadores de login, contatos desnecessários e arquivos cujo envio é atribuído à sua conta. Arquivos enviados por terceiros ou por link anônimo não são presumidos seus. Valores, estados de pagamento e referências anonimizadas necessários ao histórico de outras pessoas podem permanecer. Descrições de registros compartilhados não são apagadas indiscriminadamente.</p>
      <p className="m-0 leading-7 text-muted">Remoção de arquivos usa processamento em segundo plano com novas tentativas em caso de falha. Serviços externos podem já ter aceitado ou entregue avisos, que não podem ser recolhidos. Não prometemos um prazo legal de retenção ou exclusão não definido.</p>
      <p className="m-0 leading-7 text-muted">Contato para privacidade: {readEnv().operatorContact || "a ser informado pelo operador antes da disponibilização pública"}.</p>
      <p className="m-0 text-sm text-muted">
        <Link className="font-semibold text-primary" to="/terms">Termos de uso</Link> · <Link className="font-semibold text-primary" to="/login">Voltar</Link>
      </p>
    </main>
  );
}

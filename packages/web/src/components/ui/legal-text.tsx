type LegalTextProps = {
  kind: "terms" | "privacy";
};

export function LegalText({ kind }: LegalTextProps) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-6 text-ink">
      <h2 className="m-0 text-xl font-bold">{kind === "terms" ? "Termos de uso" : "Privacidade"}</h2>
      <p className="m-0">
        Receivy é um organizador de registros pessoais, não banco, instituição de pagamento ou processador. Não movimenta dinheiro, consulta contas bancárias ou verifica Pix automaticamente. O
        pagamento acontece fora do app; comprovantes e conciliação exigem análise manual do credor.
      </p>
      <p className="m-0">
        Usamos e-mail verificado, nome, sessões, contatos, registros financeiros e comprovantes para prestar o serviço. Push funciona quando o sistema autoriza notificações. Compartilhe documentos e
        links apenas com as pessoas envolvidas e autorizadas. Quem possui um link válido pode ver os dados mínimos da cobrança e sua chave Pix; o link vence após 90 dias e pode ser revogado.
      </p>
      <p className="m-0">Em Perfil você pode sair da conta e excluir sua conta.</p>
      <p className="m-0">
        Exclusão revoga sessões e links, remove identificadores de login, contatos desnecessários e arquivos enviados pela sua conta. Arquivos de terceiros ou enviados anonimamente podem permanecer
        com o histórico compartilhado. Mantemos valores, estados e referências anonimizadas necessários à consistência; descrições compartilhadas não são apagadas indiscriminadamente. A remoção de
        arquivos é processada em segundo plano com novas tentativas. Avisos já enviados não podem ser recolhidos.
      </p>
      <p className="m-0">
        Não afirmamos um prazo legal de retenção. Estas informações descrevem o produto, sem certificação jurídica. Contato do operador:{" "}
        {process.env.NEXT_PUBLIC_OPERATOR_CONTACT ?? "a ser informado antes da disponibilização pública"}.
      </p>
    </div>
  );
}

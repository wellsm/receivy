export default function TermsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-5 leading-7 text-ink">
      <h1 className="m-0 text-2xl font-extrabold tracking-[-0.02em] text-primary-strong">Termos de uso</h1>
      <p className="m-0 leading-7 text-muted">O Receivy organiza registros pessoais de valores a receber e pagar. Não é banco, instituição de pagamento ou processador de pagamentos. Não movimenta dinheiro nem consulta contas bancárias.</p>
      <p className="m-0 leading-7 text-muted">O Pix é feito fora do Receivy. Comprovantes enviados são registros para análise manual do credor; o aplicativo não verifica Pix automaticamente. Quem registra ou revisa um pagamento é responsável por conferir sua informação.</p>
      <p className="m-0 leading-7 text-muted">Compartilhe links e documentos apenas com as pessoas envolvidas. Não envie dados de terceiros sem autorização. Links podem ser revogados e vencem após 90 dias.</p>
      <p className="m-0 leading-7 text-muted">A exclusão encerra acesso e inicia a remoção de arquivos atribuídos à conta; histórico compartilhado pode permanecer com referências anonimizadas para preservar registros de outras pessoas. Avisos já enviados não podem ser recolhidos.</p>
      <p className="m-0 leading-7 text-muted">Contato do operador: {process.env.NEXT_PUBLIC_OPERATOR_CONTACT ?? "a ser informado pelo operador antes da disponibilização pública"}.</p>
      <p className="m-0 leading-7 text-muted">Estas informações descrevem o produto e não constituem certificação jurídica.</p>
      <p className="m-0 text-sm text-muted">
        <a className="font-semibold text-primary" href="/privacy">Privacidade</a> · <a className="font-semibold text-primary" href="/login">Voltar</a>
      </p>
    </main>
  );
}

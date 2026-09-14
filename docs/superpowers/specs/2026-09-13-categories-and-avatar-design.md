# Categorias novas e foto de perfil

Decisões de 2026-09-13. Duas mudanças independentes na mesma entrega:

1. Três categorias de conta novas (Saúde, Educação, Lazer), somando 11.
2. Foto de perfil: o usuário troca a própria foto no Perfil (web e mobile) e a foto aparece no lugar da inicial
   em todo lugar onde a pessoa aparece para quem está logado.

## Escopo

- Categorias: enum, rótulo, cor e ícone nos três pacotes; restrição do banco atualizada pelo `ez4 deploy`.
- Foto: upload só da própria foto; sem remover foto (só trocar); sem foto de contato digitada pelo dono.
- Fora do escopo: foto na página pública `/pay/` (sem sessão, continua com iniciais), foto nos e-mails e pushes,
  moderação de imagem, recorte manual no web.

## 1. Categorias

### Common (`packages/common/src/domain/billing-category.ts`)

- `BillingCategory` ganha `Health = 'health'`, `Education = 'education'`, `Leisure = 'leisure'`.
- `BILLING_CATEGORIES`, na ordem: Alimentação, Transporte, Mercado, Assinatura, Empréstimo, Moradia, Viagem,
  **Saúde, Educação, Lazer**, Outro (Outro continua por último).
- `BILLING_CATEGORY_COLORS`: `health: '#D94F70'`, `education: '#5B6BD6'`, `leisure: '#C9971C'` (tons médios
  distintos dos atuais, ≥ 3:1 sobre `surface` nos dois temas).

### Ícones

- Web (`components/ui/category-icon.tsx`, lucide já instalado): `health` → `HeartPulse`, `education` →
  `GraduationCap`, `leisure` → `Ticket`.
- Mobile: `assets/images/categories/{health,education,leisure}.svg` com o path dos mesmos ícones lucide, no mesmo
  formato dos atuais (`viewBox="0 0 24 24"`, `stroke="#000000"`, `stroke-width="2"`, pontas arredondadas), e registro
  em `components/ui/category-icon.tsx`.

### UI

- Seletores de categoria (web dropdown/bottom sheet, mobile modal) e filtros de Contas já rolam e leem
  `BILLING_CATEGORIES`; 11 itens cabem sem mudança de layout.

### Banco

- `billings_category_ck` passa a aceitar os três valores; o schema é sincronizado pelo `ez4 deploy` / `serve --local`,
  executado pelo usuário.

## 2. Foto de perfil

### Armazenamento

- Bucket `ProofFiles` (o existente), chave fixa `avatars/<userId>`: um upload novo sobrescreve o anterior, sem
  arquivos órfãos. CORS de PUT já liberado para as origens do web.
- `users` ganha `avatar_updated_at?: String.DateTime`. Nulo = sem foto. `avatar_url` continua guardando só a URL
  do provedor OAuth e não é exibido.

### Contrato (`@receivy/common`)

- `export type UserAvatar = { url: string; version: string }` — `url` assinada (`getReadUrl`, `expiresIn: 3600`),
  `version` = `avatar_updated_at`.
- `AuthUser.avatarUrl: string | null` vira `avatar: UserAvatar | null`.
- Campos novos, todos `UserAvatar | null`:
  - `ChargeSummary.counterpartAvatar`;
  - `ChargeCounterpart.avatar` (recipient do detalhe da cobrança);
  - `Contact.avatar` e `LinkableContact.avatar`;
  - `BillingGuest.avatar` e `BillingPayee.avatar`.
- Participantes do detalhe da conta são as cobranças do ciclo (`charge.recipient`), então `ChargeCounterpart.avatar`
  já os cobre; `SplitRow` (web e mobile) ganha `avatar?: UserAvatar | null`, preenchido a partir do `Contact`.

### API

- `POST /account/avatar` com body `{ mime: 'image/jpeg' | 'image/png' }` → `200 { uploadUrl, expiresAt }`: PUT
  assinado por 300 s para a chave provisória `avatar-uploads/<userId>` com `contentType: mime` (o iOS ignora
  `quality` em PNG, então o picker pode devolver PNG). Emenda da revisão final: o PUT nunca grava direto na chave
  publicada, então pular o `complete` não publica bytes sem validação e um upload ruim não apaga a foto anterior.
- `POST /account/avatar/complete` → `stat('avatar-uploads/<userId>')`:
  - ausente → `404`;
  - `type` fora de `image/jpeg`/`image/png`, `size > 2 * 1024 * 1024` ou `size === 0` → `delete` da chave provisória
    e `422` com mensagem "Envie uma imagem JPG ou PNG de até 2 MB." (a foto publicada fica como está);
  - conta excluída → `delete` da chave provisória e `404`;
  - válido → `copy` para `avatars/<userId>`, `delete` da provisória, `avatar_updated_at = now`,
    `200 { avatar: UserAvatar }`.
- Assinatura em dois passos (emenda de 2026-09-13, na escrita do plano: os repositórios não recebem o bucket, que só
  existe no contexto do endpoint, e ~22 endpoints autenticados devolvem esses DTOs):
  - `AvatarRepository.ref(userId, updatedAt): UserAvatar | null` — síncrono, sem bucket; devolve
    `{ url: 'avatars/<userId>', version: updatedAt }` (a chave do objeto no lugar da URL) ou `null`;
  - `AvatarRepository.sign(bucket, body)` — percorre a resposta e troca todo `UserAvatar` cuja `url` começa com
    `avatars/` pela URL assinada (`getReadUrl`, 3600 s); cada endpoint autenticado que devolve pessoa chama
    `sign` antes de responder. Endpoints públicos devolvem tipos próprios (`PublicChargeView` etc.) sem avatar.
  - Um endpoint que esquecer `sign` entrega só a chave: a imagem falha e o cliente cai na inicial.
- Leituras que passam a trazer `avatar_updated_at` do usuário: timeline (`counterpartName`), detalhe da cobrança e
  cobranças do ciclo da conta (`recipientOf`), contatos (lista e `linkableContacts`), convidados e recebedor da
  conta, `me`/perfil. Onde a leitura ainda não faz join com `users`, ela passa a buscar a coluna junto do nome.
- Providers de timeline, cobranças, contatos e contas passam a receber `proofFiles: Environment.Service<ProofFiles>`.
- Foto do provedor no login OAuth (`users/repositories/auth.ts`), depois de achar ou criar o usuário:
  - condição: `avatar_updated_at` nulo e `identity.picture` presente (cobre a conta criada pelo Google e o contato
    placeholder que entra pela primeira vez com Google; quem já tem foto nunca é sobrescrito);
  - baixa a imagem (só `https:`, timeout 3 s, `content-type` `image/*`, até 2 MB), grava com `write('avatars/<id>',
    bytes, { contentType })` e preenche `avatar_updated_at`;
  - qualquer falha é registrada em log (sem URL nem dados pessoais) e ignorada: o login nunca falha por causa da foto.
- Exclusão de conta (`users/services/deletion.ts`): `delete('avatars/<id>')`, `delete('avatar-uploads/<id>')` e
  `avatar_updated_at = null`.
- OpenAPI regenerado (`openapi:generate`); web adiciona `["POST", /^account\/avatar(?:\/complete)?$/]` à allowlist do
  `financial-proxy.ts`.

### Componente de avatar

- `InitialsAvatar` (web e mobile) ganha `avatar?: UserAvatar | null`:
  - com foto: imagem redonda `object-cover` do mesmo diâmetro; erro ao carregar cai para a inicial;
  - sem foto: inicial, como hoje.
- Web: `<img>` (`alt=""`, `aria-hidden`); mobile: `expo-image` com `cacheKey` = caminho da `url` sem query
  (`/avatars/<userId>`) + `:` + `version`, derivado dentro do componente — a URL assinada muda a cada resposta, a
  chave só muda quando a foto muda.
- Usos que passam a enviar a foto: Feed, detalhe da cobrança, detalhe da conta (convidados, participantes,
  recebedor), seletor de contatos, editor de divisão, recebedor e contatos no formulário de conta. O chip "Eu" do
  formulário continua com inicial.

### Perfil web (`components/screens/profile-screen.tsx`)

- Foto de 96 px com botão redondo de lápis (`Pencil`, lucide) centralizado sobre ela, `aria-label="Trocar foto"`.
- Abre `<input type="file" accept="image/jpeg,image/png,image/webp,image/heic">` oculto.
- Canvas: recorte central quadrado, 512 × 512, `toBlob('image/jpeg', 0.85)`.
- Fluxo: `POST /api/financial/account/avatar` → `PUT uploadUrl` (`content-type: image/jpeg`,
  `credentials: 'omit'`) → `POST .../complete` → atualiza a foto na tela.
- Durante o envio: spinner sobre a foto, lápis desabilitado; erro em `role="alert"` abaixo.

### Perfil mobile (`components/screens/profile-screen.tsx`)

- Dependência nova aprovada: `expo-image-picker` (versão do SDK 56 via `npx expo install`); plugin no `app.json` com
  `photosPermission: "O Receivy usa suas fotos para trocar a foto do perfil."`. Exige rebuild nativo.
- Lápis centralizado sobre a foto (`accessibilityLabel="Trocar foto"`) →
  `ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 })`
  (`aspect` só vale no Android; no iOS o recorte já é quadrado).
- Cancelado → nada. Selecionado → mesmo fluxo de upload com `mime = asset.mimeType` (`expo/fetch` PUT com `File`),
  spinner sobre a foto.
- `mimeType` fora de JPEG/PNG ou `fileSize > 2 MB` → mensagem "Envie uma imagem JPG ou PNG de até 2 MB." sem chamar a
  API.

## Testes

- common: 11 categorias com rótulo e cor; `billingCategoryLabel` das novas.
- API:
  - `complete` aceita JPEG e PNG válidos, rejeita tipo errado, vazio e > 2 MB (apaga o objeto);
  - `avatarFor` devolve `null` sem `avatar_updated_at`;
  - timeline, detalhe da cobrança, contatos e detalhe da conta incluem o avatar;
  - login OAuth aplica a foto só sem foto anterior e não falha quando o download falha.
- web: `InitialsAvatar` com foto, sem foto e com erro de imagem; Perfil troca a foto (fetch e canvas simulados);
  allowlist do proxy.
- mobile: `InitialsAvatar` com e sem foto; Perfil com picker simulado (cancelado e selecionado); ícones das
  categorias novas.
- Guardas de cor (`theme-tokens.test.ts`) continuam verdes.

## Verificação

- Cada pacote: `check-types`, `lint`, `test`; API também `openapi:check`.
- Usuário: `ez4 serve --local`/`deploy` (constraint e coluna nova), rebuild do mobile, QA manual de troca de foto
  nos dois apps e da foto aparecendo para a outra pessoa.

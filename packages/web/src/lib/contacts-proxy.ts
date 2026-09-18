import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE } from "./auth/cookies";
import { hasTrustedOrigin } from "./auth/origin";
import { authApiFetch } from "./auth/api";

export async function contactsProxy(request: Request, path: string) {
  if (request.method !== "GET" && !hasTrustedOrigin(request)) {
    return new NextResponse(null, { status: 403 });
  }

  const token = (await cookies()).get(ACCESS_COOKIE)?.value;

  if (!token) {
    return new NextResponse(null, { status: 401 });
  }

  try {
    const upstream = await authApiFetch(path, {
      method: request.method, headers: { authorization: `Bearer ${token}` },
      ...(request.method !== "GET" ? { body: await request.text() } : {}),
    });

    if (!upstream.ok) {
      const status = [400, 401, 403, 404, 409].includes(upstream.status) ? upstream.status : 503;
      const message = status === 409 ? "Esse e-mail já está em uso: por outro contato seu ou por uma conta ativa. Só o apelido de um contato ativo pode mudar."
        : status === 404 ? "Contato não encontrado."
        : status === 400 ? "Confira o nome e o e-mail informados." : "Não foi possível acessar seus contatos.";

      return NextResponse.json({ message }, { status });
    }
    if (upstream.status === 204) {
      return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json(await upstream.json(), { status: upstream.status, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ message: "Serviço indisponível. Tente novamente." }, { status: 503 }); }
}

import type { AuthSessionResponse } from "@receivy/common";
import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";
import { hasTrustedOrigin } from "@/lib/auth/origin";
import { sessionResponse } from "@/lib/auth/response";

const invalidCode = () => NextResponse.json(
  { message: "Código inválido ou expirado. Peça um novo código e tente novamente." },
  { status: 401 },
);

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json({ message: "Origem inválida." }, { status: 403 });
  }

  try {
    const upstream = await authApiFetch("auth/email/confirm", {
      method: "POST",
      body: await request.text(),
    });

    if (upstream.status === 400 || upstream.status === 401) {
      return invalidCode();
    }
    if (!upstream.ok) {
      return NextResponse.json(
        { message: "Não foi possível entrar agora." },
        { status: 503 },
      );
    }

    return sessionResponse((await upstream.json()) as AuthSessionResponse);
  } catch {
    return NextResponse.json(
      { message: "Não foi possível entrar agora." },
      { status: 503 },
    );
  }
}

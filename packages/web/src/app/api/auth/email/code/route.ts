import { NextResponse } from "next/server";
import { authApiFetch } from "@/lib/auth/api";
import { hasTrustedOrigin } from "@/lib/auth/origin";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) {
    return NextResponse.json({ message: "Origem inválida." }, { status: 403 });
  }

  try {
    const upstream = await authApiFetch("auth/email/code", {
      method: "POST",
      body: await request.text(),
    });

    if (upstream.status >= 500) {
      return NextResponse.json(
        { message: "Não foi possível enviar o código agora." },
        { status: 503 },
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { message: "Não foi possível enviar o código agora." },
      { status: 503 },
    );
  }
}

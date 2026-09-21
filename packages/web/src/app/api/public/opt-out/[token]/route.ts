import { authApiFetch } from "@/lib/auth/api";

export async function DELETE(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const response = await authApiFetch(`public/notices/opt-out/${encodeURIComponent(token)}`, { method: "DELETE" });

  return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
}

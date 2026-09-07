import { publicProofProxy } from "@/lib/public-proof-proxy";
export async function POST(request: Request, { params }: { params: Promise<{ token: string; path: string[] }> }) {
  const { token, path } = await params; return publicProofProxy(request, token, path.join("/"));
}
export const GET = POST;

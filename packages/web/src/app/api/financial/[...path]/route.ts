import { financialProxy } from "@/lib/financial-proxy";

type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  const { path } = await context.params;
  const query = new URL(request.url).search;
  return financialProxy(request, `${path.join("/")}${query}`);
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;

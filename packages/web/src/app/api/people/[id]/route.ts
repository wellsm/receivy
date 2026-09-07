import { peopleProxy } from "@/lib/people-proxy";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return peopleProxy(request, `people/${encodeURIComponent(id)}`);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return peopleProxy(request, `people/${encodeURIComponent(id)}`);
}

import { peopleProxy } from "@/lib/people-proxy";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return peopleProxy(request, `people/${encodeURIComponent(id)}/archive`);
}

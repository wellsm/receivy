import { contactsProxy } from "@/lib/contacts-proxy";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return contactsProxy(request, `contacts/${encodeURIComponent(id)}/archive`);
}

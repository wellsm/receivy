import { contactsProxy } from "@/lib/contacts-proxy";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  return contactsProxy(request, `contacts/${encodeURIComponent(id)}`);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  return contactsProxy(request, `contacts/${encodeURIComponent(id)}`);
}

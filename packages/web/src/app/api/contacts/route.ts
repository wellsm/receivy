import { contactsProxy } from "@/lib/contacts-proxy";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = new URLSearchParams();

  for (const key of ["cursor", "archived", "search", "sort"]) {
    const value = params.get(key);

    if (value !== null) {
      query.set(key, value);
    }
  }

  return contactsProxy(request, `contacts?${query}`);
}
export async function POST(request: Request) { return contactsProxy(request, "contacts"); }

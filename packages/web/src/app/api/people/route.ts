import { peopleProxy } from "@/lib/people-proxy";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = new URLSearchParams();
  for (const key of ["cursor", "archived", "search"]) {
    const value = params.get(key);
    if (value !== null) query.set(key, value);
  }
  return peopleProxy(request, `people?${query}`);
}
export async function POST(request: Request) { return peopleProxy(request, "people"); }

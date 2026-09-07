import { apiErrorMessage } from "@receivy/common";
export async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { code?: unknown };
    return apiErrorMessage(body.code, fallback);
  } catch {
    return fallback;
  }
}

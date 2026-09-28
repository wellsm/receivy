import { apiErrorMessage } from "@receivy/common";

export async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    return apiErrorMessage(response.status, await response.json(), fallback);
  } catch {
    return apiErrorMessage(response.status, null, fallback);
  }
}

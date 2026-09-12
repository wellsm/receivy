export interface ExpoPushMessage {
  token: string;
  title: string;
  body: string;
  url: string;
}

export interface ExpoTicketResponse {
  data?: { status?: string; id?: string; details?: { error?: string } };
}

export interface ExpoReceiptResponse {
  data?: Record<string, { status?: string; details?: { error?: string } }>;
}

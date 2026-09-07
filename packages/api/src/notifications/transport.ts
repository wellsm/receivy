export type SendResult =
  | { status: "accepted"; id: string }
  | {
      status:
        | "disabled"
        | "transient"
        | "permanent"
        | "device_unregistered"
        | "uncertain";
    };
export type ReceiptResult = {
  status:
    | "observation_failed"
    | "delivered"
    | "pending"
    | "transient"
    | "permanent"
    | "device_unregistered"
    | "disabled";
};
export interface EmailNotice {
  to: string;
  key: string;
  subject: string;
  text: string;
  from: string;
}
export interface NotificationTransport {
  email(input: EmailNotice): Promise<SendResult>;
  push(input: {
    token: string;
    title: string;
    body: string;
    url: string;
  }): Promise<SendResult>;
  receipt(ticket: string): Promise<ReceiptResult>;
}
/** Provider bodies/errors never escape this boundary or enter logs. */
export function notificationTransport(
  env: Record<string, string | undefined>,
  request: typeof fetch = globalThis.fetch,
): NotificationTransport {
  const expoHeaders = {
    "Content-Type": "application/json",
    ...(env.EXPO_ACCESS_TOKEN && env.EXPO_ACCESS_TOKEN !== "disabled"
      ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` }
      : {}),
  };
  async function post(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ) {
    return request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  }
  function httpFailure(status: number): "transient" | "permanent" {
    return status === 429 || status >= 500 ? "transient" : "permanent";
  }
  function expoError(
    error?: string,
  ): "device_unregistered" | "transient" | "permanent" {
    return error === "DeviceNotRegistered"
      ? "device_unregistered"
      : error === "MessageRateExceeded"
        ? "transient"
        : "permanent";
  }
  return {
    async email(input) {
      if (env.NOTIFICATION_EMAIL_TRANSPORT !== "resend")
        return { status: "disabled" };
      if (
        !env.RESEND_API_KEY ||
        env.RESEND_API_KEY === "disabled" ||
        !input.from ||
        input.from === "disabled"
      )
        return { status: "permanent" };
      try {
        const response = await post(
          "https://api.resend.com/emails",
          {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": input.key,
          },
          {
            from: input.from,
            to: [input.to],
            subject: input.subject,
            text: input.text,
          },
        );
        if (!response.ok) return { status: httpFailure(response.status) };
        const body = (await response.json()) as { id?: string };
        return typeof body.id === "string"
          ? { status: "accepted", id: body.id }
          : { status: "uncertain" };
      } catch {
        return { status: "uncertain" };
      }
    },
    async push(input) {
      if (env.NOTIFICATION_PUSH_TRANSPORT !== "expo")
        return { status: "disabled" };
      try {
        const response = await post(
          "https://exp.host/--/api/v2/push/send",
          expoHeaders,
          {
            to: input.token,
            title: input.title,
            body: input.body,
            data: { url: input.url },
            sound: "default",
          },
        );
        if (!response.ok) return { status: httpFailure(response.status) };
        const body = (await response.json()) as {
          data?: { status?: string; id?: string; details?: { error?: string } };
        };
        if (body.data?.status === "ok" && typeof body.data.id === "string")
          return { status: "accepted", id: body.data.id };
        return body.data?.status === "error"
          ? { status: expoError(body.data.details?.error) }
          : { status: "uncertain" };
      } catch {
        return { status: "uncertain" };
      }
    },
    async receipt(ticket) {
      if (env.NOTIFICATION_PUSH_TRANSPORT !== "expo")
        return { status: "disabled" };
      try {
        const response = await post(
          "https://exp.host/--/api/v2/push/getReceipts",
          expoHeaders,
          { ids: [ticket] },
        );
        // A failed query says nothing about delivery of the already accepted push.
        if (!response.ok)
          return {
            status:
              httpFailure(response.status) === "transient"
                ? "transient"
                : "observation_failed",
          };
        const body = (await response.json()) as {
          data?: Record<
            string,
            { status?: string; details?: { error?: string } }
          >;
        };
        const receipt = body.data?.[ticket];
        if (!receipt) return { status: "pending" };
        if (receipt.status === "ok") return { status: "delivered" };
        return receipt.status === "error"
          ? { status: expoError(receipt.details?.error) }
          : { status: "observation_failed" };
      } catch {
        return { status: "transient" };
      }
    },
  };
}

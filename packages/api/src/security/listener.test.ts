import { expect, it, vi } from "vitest";
import { ServiceEventType, type Service } from "@ez4/common";
import { HttpBadRequestError } from "@ez4/gateway";
import type { ApiProvider } from "../provider";
import { requestListener } from "./listener";
import { trustedClientIp } from "./throttle";

it("keeps allowlisted correlation/status but no body, path, headers or error content", () => {
  const logger = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    requestListener({ type: ServiceEventType.Error, request: { traceId: "a3a49925-d9d4-4919-a670-8c59dd0d04bd", path: "/pay/secret-token", data: "email@example.com" }, error: new HttpBadRequestError("secret-phone-pix-filename") }, {} as Service.Context<ApiProvider>);
    expect(logger).toHaveBeenCalledWith({ event: "request_failed", correlationId: "a3a49925-d9d4-4919-a670-8c59dd0d04bd", status: 400 });
    expect(trustedClientIp({ headers: { "x-forwarded-for": "192.0.2.1" }, body: { sourceIp: "192.0.2.1" } })).toBe("unknown-client");
    expect(trustedClientIp({ sourceIp: "192.0.2.2" })).toBe("192.0.2.2");
  } finally { logger.mockRestore(); }
});

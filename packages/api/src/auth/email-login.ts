import type {
  AuthSessionResponse,
  AuthUser,
  ConfirmEmailCodeBody,
  RequestEmailCodeBody,
} from "@receivy/common";
import { normalizeEmail } from "@receivy/common";
import { generateEmailCode } from "./code";
import { issueAccessToken } from "./session";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export type LoginCodeOutcome =
  | { kind: "valid" }
  | { kind: "invalid" | "expired" | "exhausted" };

export interface AuthRepository {
  replaceLoginCode(input: {
    code: string;
    codeHashKey: string;
    email: string;
  }): Promise<{ accepted: boolean }>;
  consumeLoginCode(input: {
    code: string;
    codeHashKey: string;
    email: string;
  }): Promise<LoginCodeOutcome>;
  findOrCreateUserByEmail(email: string): Promise<AuthUser>;
  issueSession(userId: string, deviceName?: string): Promise<{
    familyId: string;
    refreshToken: string;
  }>;
}

export interface EmailTransport {
  sendLoginCode(input: { code: string; email: string }): Promise<void>;
}

export class AuthFlowError extends Error {
  constructor(readonly code: "INVALID_CODE") {
    super("Não foi possível confirmar o código.");
    this.name = "AuthFlowError";
  }
}

type RequestEmailCodeDependencies = {
  codeHashKey: string;
  generateCode?: () => string;
  repo: AuthRepository;
  transport: EmailTransport;
};

export async function requestEmailCode(
  input: RequestEmailCodeBody,
  {
    codeHashKey,
    generateCode = generateEmailCode,
    repo,
    transport,
  }: RequestEmailCodeDependencies,
): Promise<void> {
  const email = normalizeEmail(input.email);
  const code = generateCode();
  const result = await repo.replaceLoginCode({ code, codeHashKey, email });

  if (result.accepted) {
    try { await transport.sendLoginCode({ code, email }); }
    catch { console.warn({ event: "login_email_delivery_failed" }); }
  }
}

type ConfirmEmailCodeDependencies = {
  accessTokenSecret: string;
  codeHashKey: string;
  repo: AuthRepository;
};

export async function confirmEmailCode(
  input: ConfirmEmailCodeBody,
  { accessTokenSecret, codeHashKey, repo }: ConfirmEmailCodeDependencies,
): Promise<AuthSessionResponse> {
  const email = normalizeEmail(input.email);
  const outcome = await repo.consumeLoginCode({
    code: input.code,
    codeHashKey,
    email,
  });

  if (outcome.kind !== "valid") {
    throw new AuthFlowError("INVALID_CODE");
  }

  const user = await repo.findOrCreateUserByEmail(email);
  const session = await repo.issueSession(user.id, input.deviceName);
  const accessToken = issueAccessToken({
    familyId: session.familyId,
    secret: accessTokenSecret,
    userId: user.id,
  });

  return {
    accessToken,
    refreshToken: session.refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    user,
  };
}

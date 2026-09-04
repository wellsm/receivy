import type { LogoutBody, RefreshSessionBody, SessionTokens } from "@receivy/common";
import { issueAccessToken } from "./session";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export type RotateRefreshTokenOutcome =
  | {
      kind: "rotated";
      familyId: string;
      refreshToken: string;
      userId: string;
    }
  | { kind: "invalid" | "expired" | "replayed" };

export interface SessionRepository {
  rotateRefreshToken(token: string): Promise<RotateRefreshTokenOutcome>;
  revokeFamilyByRefreshToken(token: string): Promise<void>;
}

export class SessionFlowError extends Error {
  constructor(readonly code: "INVALID_SESSION") {
    super("Sessão inválida ou expirada.");
    this.name = "SessionFlowError";
  }
}

export async function refreshSession(
  input: RefreshSessionBody,
  dependencies: { accessTokenSecret: string; repo: SessionRepository },
): Promise<SessionTokens> {
  const outcome = await dependencies.repo.rotateRefreshToken(input.refreshToken);

  if (outcome.kind !== "rotated") {
    throw new SessionFlowError("INVALID_SESSION");
  }

  return {
    accessToken: issueAccessToken({
      familyId: outcome.familyId,
      secret: dependencies.accessTokenSecret,
      userId: outcome.userId,
    }),
    refreshToken: outcome.refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function revokeSession(
  input: LogoutBody,
  dependencies: { repo: SessionRepository },
): Promise<void> {
  await dependencies.repo.revokeFamilyByRefreshToken(input.refreshToken);
}

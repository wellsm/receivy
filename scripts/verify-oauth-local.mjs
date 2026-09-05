import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

// Only targets the Receivy development container and a newly generated fixture.
const base = "http://127.0.0.1:3735/local-receivy-api";
const userId = randomUUID();
const grantId = randomUUID();
const code = randomBytes(32).toString("base64url");
const verifier = randomBytes(32).toString("base64url");
const hash = value => createHash("sha256").update(value).digest("base64url");
const sql = query => execFileSync("docker", ["exec", "receivy-pg", "psql", "-U", "receivy", "-d", "receivy", "-v", "ON_ERROR_STOP=1", "-c", query], { stdio: ["ignore", "pipe", "pipe"] });
const exchange = value => fetch(`${base}/auth/oauth/exchange`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ code, codeVerifier: value }),
});
try {
  sql(`BEGIN;
    INSERT INTO users (id,email,locale,timezone,country,currency,created_at,updated_at)
      VALUES ('${userId}','oauth-${userId}@example.com','pt-BR','America/Sao_Paulo','BR','BRL',now(),now());
    INSERT INTO oauth_grants (id,user_id,grant_hash,client_challenge,expires_at,created_at)
      VALUES ('${grantId}','${userId}','${hash(code)}','${hash(verifier)}',now()+interval '2 minutes',now());
    COMMIT;`);
  const wrong = await exchange("a".repeat(43));
  if (wrong.status !== 401) throw new Error(`Wrong verifier: expected 401, got ${wrong.status}`);
  const valid = await exchange(verifier);
  if (valid.status !== 200) throw new Error(`Valid verifier: expected 200, got ${valid.status}`);
  const session = await valid.json();
  if (session.user.id !== userId || session.accessToken.split(".").length !== 3 || session.refreshToken.length !== 43) {
    throw new Error("Invalid session response shape");
  }
  const replay = await exchange(verifier);
  if (replay.status !== 401) throw new Error(`Replay: expected 401, got ${replay.status}`);
  console.log("OAuth local: wrong verifier 401; valid exchange 200; replay 401; session shape verified.");
} finally {
  sql(`BEGIN;
    DELETE FROM refresh_tokens WHERE family_id IN (SELECT id FROM session_families WHERE user_id='${userId}');
    DELETE FROM session_families WHERE user_id='${userId}';
    DELETE FROM oauth_grants WHERE user_id='${userId}';
    DELETE FROM users WHERE id='${userId}';
    COMMIT;`);
  console.log("OAuth local: isolated fixture removed.");
}

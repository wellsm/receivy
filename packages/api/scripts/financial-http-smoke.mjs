import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

const cwd = new URL("..", import.meta.url).pathname;
const compose = ["compose", "-p", "receivy-financial-http-smoke", "-f", "docker-compose.http-smoke.yml"];
const apiBase = "http://127.0.0.1:47365/http-smoke-receivy-api";
const jwtSecret = "http-smoke-jwt-secret";
let server;
let serverOutput = "";

function run(command, args) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
}

function accessToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({ aud: "receivy-clients", exp: now + 900, iat: now, iss: "receivy-api", sid: randomUUID(), sub: userId });
  const signature = createHmac("sha256", jwtSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}/${path}`, options);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function waitForApi() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`API exited before readiness\n${serverOutput}`);
    try {
      const health = await request("health");
      if (health.status === 200) return health;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`API readiness timed out\n${serverOutput}`);
}

try {
  run("docker", [...compose, "up", "-d", "--wait"]);
  server = spawn("pnpm", ["exec", "ez4", "serve", "--local", "--reset"], {
    cwd,
    env: {
      ...process.env,
      APP_STAGE: "http-smoke",
      API_LOCAL_PORT: "47365",
      EZ4_RAW_PG_DB_URL: "postgresql://receivy:receivy@127.0.0.1:55435/receivy",
      AUTH_JWT_SECRET: jwtSecret,
      LOGIN_CODE_HASH_KEY: "http-smoke-code-hash",
      PUBLIC_LINK_HMAC_SECRET: "http-smoke-public-link-secret",
      EMAIL_TRANSPORT: "disabled",
      RESEND_API_KEY: "disabled",
      RESEND_FROM_EMAIL: "disabled@example.invalid",
      OAUTH_PROVIDERS_CONFIG_B64: "disabled",
      OAUTH_REDIRECT_ALLOW_LIST: "http://localhost:3000/auth/oauth/callback",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", chunk => { serverOutput = `${serverOutput}${chunk}`.slice(-20_000); });
  server.stderr.on("data", chunk => { serverOutput = `${serverOutput}${chunk}`.slice(-20_000); });

  const health = await waitForApi();
  assert.deepEqual(health.body, { status: "ok", service: "receivy-api" });
  assert.equal((await request("payment-methods", { method: "GET" })).status, 401);

  const authorization = `Bearer ${accessToken("11111111-1111-4111-8111-111111111111")}`;
  const malformed = await request("payment-methods", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ pixKeyType: "cpf" }),
  });
  assert.equal(malformed.status, 400);

  const invalidPix = await request("payment-methods", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ pixKeyType: "cpf", pixKey: "123" }),
  });
  assert.equal(invalidPix.status, 400);
  assert.equal((await request("public/charges/not-a-capability")).status, 404);
  // Disposable container-only fixture. Business behavior stays in DatabaseTester specs;
  // this assertion covers EZ4's real generated request/response serialization.
  run("docker", [...compose, "exec", "-T", "postgres", "psql", "-U", "receivy", "-d", "receivy", "-v", "ON_ERROR_STOP=1", "-c",
    "INSERT INTO users (id,email,name,locale,timezone,country,currency,created_at,updated_at) VALUES ('11111111-1111-4111-8111-111111111111','recurrence-http@example.invalid','HTTP fixture','pt-BR','America/Sao_Paulo','BR','BRL',now(),now())"]);
  const headers = { authorization, "content-type": "application/json" };
  const person = await request("people", { method: "POST", headers, body: JSON.stringify({ name: "Ana HTTP" }) });
  assert.equal(person.status, 201);
  const recurrence = { description: "HTTP mensal", totalCents: 10001, frequency: "monthly", day: 31,
    timezone: "America/Sao_Paulo", split: { mode: "equal", parts: [{ kind: "person", personId: person.body.id }, { kind: "owner" }] },
    reminders: [{ offsetDays: -5, channel: "auto", enabled: true }, { offsetDays: 0, channel: "auto", enabled: false }] };
  const created = await request("recurrences", { method: "POST", headers: { ...headers, "idempotency-key": randomUUID() }, body: JSON.stringify(recurrence) });
  assert.equal(created.status, 201);
  const read = await request(`recurrences/${created.body.id}`, { headers });
  assert.equal(read.status, 200);
  for (const result of [created.body, read.body]) {
    for (const key of Object.keys(recurrence)) assert.deepEqual(result[key], recurrence[key], `recurrence HTTP field ${key}`);
    assert.equal(typeof result.startDate, "string");
    assert.equal(result.state, "active");
    assert.equal(result.previews[0].amount.amountCents, 5001);
  }
  for (const split of [
    { mode: "percentage", parts: [{ kind: "person", personId: person.body.id, basisPoints: 5000 }, { kind: "owner", basisPoints: 5000 }] },
    { mode: "fixed", parts: [{ kind: "person", personId: person.body.id, amountCents: 5001 }] },
  ]) {
    const variant = await request("recurrences", { method: "POST", headers: { ...headers, "idempotency-key": randomUUID() }, body: JSON.stringify({ ...recurrence, split }) });
    assert.equal(variant.status, 201); assert.deepEqual(variant.body.split, split);
    const detail = await request(`recurrences/${variant.body.id}`, { headers });
    assert.equal(detail.status, 200); assert.deepEqual(detail.body.split, split);
    assert.equal(detail.body.totalCents, 10001);
    const listed = await request("recurrences", { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.recurrences.find(rule => rule.id === variant.body.id).split, split);
  }
  process.stdout.write("financial HTTP transport smoke: PASS\n");
} catch (error) {
  process.stderr.write(serverOutput);
  throw error;
} finally {
  if (server && server.exitCode === null) server.kill("SIGTERM");
  run("docker", [...compose, "down", "--remove-orphans"]);
}

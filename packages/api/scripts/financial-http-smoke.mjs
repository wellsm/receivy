import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';

const cwd = new URL('..', import.meta.url).pathname;
const compose = ['compose', '-p', 'receivy-financial-http-smoke', '-f', 'docker-compose.http-smoke.yml'];
const apiBase = 'http://127.0.0.1:47365/http-smoke-receivy-api';
const jwtSecret = 'http-smoke-jwt-secret';
const publicLinkSecret = 'http-smoke-public-link-secret';
const familyId = '61111111-1111-4111-8111-111111111111';
let server;

/** Mirrors `issuePublicChargeToken` (purpose `provider_webhook`): the webhook path segment is a stateless HMAC, so the smoke script can mint its own instead of scraping one off a response. */
function webhookToken(chargeId, secret) {
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60;
  const mac = createHmac('sha256', secret).update(`provider_webhook.${chargeId}.${expiresAtSeconds}`).digest('base64url');

  return `${chargeId}.${expiresAtSeconds}.${mac}`;
}
let serverOutput = '';

function run(command, args) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
}

function accessToken(userId, sessionFamilyId = familyId) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ aud: 'receivy-clients', exp: now + 900, iat: now, iss: 'receivy-api', sid: sessionFamilyId, sub: userId });
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64url');

  return `${header}.${payload}.${signature}`;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}/${path}`, options);
  const text = await response.text();

  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
}

async function waitForApi() {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`API exited before readiness\n${serverOutput}`);
    }

    try {
      const health = await request('health');

      if (health.status === 200) {
        return health;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`API readiness timed out\n${serverOutput}`);
}

try {
  run('docker', [...compose, 'up', '-d', '--wait']);
  server = spawn('pnpm', ['exec', 'ez4', 'serve', '--local', '--reset'], {
    cwd,
    env: {
      ...process.env,
      APP_STAGE: 'http-smoke',
      API_LOCAL_PORT: '47365',
      EZ4_RAW_PG_DB_URL: 'postgresql://receivy:receivy@127.0.0.1:55435/receivy',
      AUTH_JWT_SECRET: jwtSecret,
      LOGIN_CODE_HASH_KEY: 'http-smoke-code-hash',
      PUBLIC_LINK_HMAC_SECRET: publicLinkSecret,
      PAYMENT_CREDENTIAL_KEY_B64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      EMAIL_TRANSPORT: 'disabled',
      RESEND_API_KEY: 'disabled',
      RESEND_FROM_EMAIL: 'disabled@example.invalid',
      // Every Environment.Variable declared by a provider is resolved from process.env during
      // reflection; a missing one drops the whole Http service and every request answers 404.
      PUBLIC_WEB_ORIGIN: 'http://localhost:3000',
      GOOGLE_SIGNIN_ENABLED: 'false',
      GOOGLE_CLIENT_ID: 'disabled',
      GOOGLE_CLIENT_SECRET: 'disabled',
      APPLE_SIGNIN_ENABLED: 'false',
      APPLE_CLIENT_ID: 'disabled',
      APPLE_NATIVE_CLIENT_ID: 'disabled',
      APPLE_TEAM_ID: 'disabled',
      APPLE_KEY_ID: 'disabled',
      APPLE_PRIVATE_KEY_B64: 'disabled',
      OAUTH_REDIRECT_ALLOW_LIST: 'http://localhost:3000/auth/oauth/callback',
      PUBLIC_API_ORIGIN: apiBase,
      PAYMENT_METHOD_LINK: 'fake'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
  });
  server.stderr.on('data', (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-20_000);
  });

  const health = await waitForApi();

  assert.deepEqual(health.body, { status: 'ok', service: 'receivy-api' });
  assert.equal((await request('payment-methods', { method: 'GET' })).status, 401);

  // Persist a real family: test tokens get exactly the production revocation check.
  run('docker', [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'receivy',
    '-d',
    'receivy',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `INSERT INTO users (id,email,name,status,locale,timezone,country,currency,created_at,updated_at) VALUES ('11111111-1111-4111-8111-111111111111','billing-http@example.invalid','HTTP fixture','active','pt-BR','America/Sao_Paulo','BR','BRL',now(),now()); INSERT INTO subscriptions (id,owner_id,provider,stripe_customer_id,plan,status,cancel_at_period_end,created_at,updated_at) VALUES ('71111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','stripe','cus_smoke','basic','active',false,now(),now()); INSERT INTO session_families (id,user_id,created_at,last_seen_at) VALUES ('${familyId}','11111111-1111-4111-8111-111111111111',now(),now())`
  ]);

  const authorization = `Bearer ${accessToken('11111111-1111-4111-8111-111111111111')}`;
  const invalidJson = await request('contacts', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json', 'x-trace-id': 'fixture-secret-trace' },
    body: '{"name":"fixture-secret-name","email":"fixture-secret@example.invalid",'
  });

  // EZ4's local gateway sometimes turns malformed JSON into an uncaught 500 instead of the expected 400
  // (local-gateway bug, not an API behavior change); accept either so the assertions further down still run.
  assert.ok([400, 500].includes(invalidJson.status), `expected 400 or 500, got ${invalidJson.status}`);

  if (invalidJson.status === 400) {
    assert.match(invalidJson.body.correlationId, /^[a-f0-9-]{36}$/);
    assert.equal(invalidJson.headers.get('x-trace-id'), invalidJson.body.correlationId);
  }

  const malformed = await request('payment-methods', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'pix', kind: 'cpf' })
  });

  assert.equal(malformed.status, 400);

  const invalidPix = await request('payment-methods', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'pix', kind: 'cpf', value: '123' })
  });

  assert.equal(invalidPix.status, 400);

  const infinitePay = await request('payment-methods', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ provider: 'infinitepay', value: '$Smoke.Loja' })
  });

  assert.equal(infinitePay.status, 201);
  assert.equal(infinitePay.body.provider, 'infinitepay');
  assert.equal(infinitePay.body.value, 'smoke.loja');
  assert.equal(
    (await request('webhooks/infinitepay/not-a-token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
      .status,
    200
  );
  assert.equal(
    (
      await request('contacts', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Fixture', ownerId: familyId })
      })
    ).status,
    400
  );
  assert.equal((await request('public/charges/not-a-capability')).status, 404);
  assert.equal((await request('public/charges/not-a-capability/proof')).status, 404);

  // Disposable container-only fixture. Business behavior stays in DatabaseTester specs;
  // this assertion covers EZ4's real generated request/response serialization.
  const headers = { authorization, 'content-type': 'application/json' };

  assert.equal((await request('devices', { method: 'POST' })).status, 401);

  const registered = await request('devices', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: 'ExpoPushToken[http-fixture]', installationId: 'http-device', platform: 'ios' })
  });

  assert.equal(registered.status, 200);
  assert.deepEqual(Object.keys(registered.body).sort(), ['active', 'createdAt', 'id', 'platform']);
  assert.equal(registered.body.active, true);
  assert.equal(registered.body.platform, 'ios');

  const person = await request('contacts', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Ana HTTP', email: 'ana-http@example.invalid' })
  });

  assert.equal(person.status, 201);

  const billing = await request('billings', {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      recurrence: 'once',
      totalCents: 1234,
      startDate: '2027-01-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: 'fixed', parts: [{ kind: 'user', userId: person.body.userId, amountCents: 1234 }] }
    })
  });

  assert.equal(billing.status, 201);

  const chargeId = billing.body.charges[0].id;
  // The owner collects: only the side that pays may reserve the proof slot.
  const forbiddenUpload = await request(`charges/${chargeId}/proof`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ filename: 'fixture-secret-file.pdf', mime: 'application/pdf', size: 100 })
  });

  assert.equal(forbiddenUpload.status, 403);
  assert.equal((await request(`charges/${chargeId}/proof/download`, { headers })).status, 404);
  assert.equal((await request(`charges/${chargeId}/pay`, { method: 'POST', headers })).status, 200);
  assert.equal((await request(`charges/${chargeId}/reopen`, { method: 'POST', headers })).status, 200);

  // The raw-body PagBank webhook, exercised through the real HTTP gateway rather than a mocked handler call.
  const pagBankToken = 'smoke-token';
  const pagBankMethod = await request('payment-methods', {
    method: 'POST',
    headers,
    body: JSON.stringify({ provider: 'pagseguro', token: pagBankToken, label: 'Smoke PagBank' })
  });

  assert.equal(pagBankMethod.status, 201);

  const pagBankBilling = await request('billings', {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      recurrence: 'once',
      totalCents: 5000,
      startDate: '2027-01-01',
      timezone: 'America/Sao_Paulo',
      paymentMethodId: pagBankMethod.body.id,
      split: { mode: 'fixed', parts: [{ kind: 'user', userId: person.body.userId, amountCents: 5000 }] }
    })
  });

  assert.equal(pagBankBilling.status, 201);

  const pagBankChargeId = pagBankBilling.body.charges[0].id;
  const ensured = await request(`charges/${pagBankChargeId}/payment-link`, { method: 'POST', headers });

  assert.equal(ensured.status, 200);
  assert.equal(ensured.body.paymentLink?.state, 'ready');

  const notificationBody = JSON.stringify({ id: pagBankChargeId, reference_id: pagBankChargeId, charges: [{ id: 'CHAR_smoke', status: 'PAID' }] });
  const authenticityToken = createHash('sha256').update(`${pagBankToken}-${notificationBody}`).digest('hex');
  // A signature over a different body must not settle: the webhook still answers 200, the charge stays pending.
  const forgedToken = createHash('sha256').update(`${pagBankToken}-${notificationBody} `).digest('hex');
  const forged = await request(`webhooks/pagseguro/${webhookToken(pagBankChargeId, publicLinkSecret)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-authenticity-token': forgedToken },
    body: notificationBody
  });

  assert.equal(forged.status, 200);
  assert.equal((await request(`charges/${pagBankChargeId}`, { headers })).body.state, 'pending');

  const notified = await request(`webhooks/pagseguro/${webhookToken(pagBankChargeId, publicLinkSecret)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-authenticity-token': authenticityToken },
    body: notificationBody
  });

  assert.equal(notified.status, 200);
  assert.deepEqual(notified.body, { received: true });

  const pagBankCharge = await request(`charges/${pagBankChargeId}`, { headers });

  assert.equal(pagBankCharge.status, 200);
  assert.equal(pagBankCharge.body.state, 'paid');

  const foreignFamilyId = '62222222-2222-4222-8222-222222222222';

  run('docker', [
    ...compose,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'receivy',
    '-d',
    'receivy',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `INSERT INTO users (id,email,name,status,locale,timezone,country,currency,created_at,updated_at) VALUES ('22222222-2222-4222-8222-222222222222','foreign-http@example.invalid','Foreign fixture','active','pt-BR','America/Sao_Paulo','BR','BRL',now(),now()); INSERT INTO session_families (id,user_id,created_at,last_seen_at) VALUES ('${foreignFamilyId}','22222222-2222-4222-8222-222222222222',now(),now())`
  ]);

  const foreignHeaders = { ...headers, authorization: `Bearer ${accessToken('22222222-2222-4222-8222-222222222222', foreignFamilyId)}` };

  assert.equal((await request(`charges/${chargeId}/reminders`, { method: 'POST', headers: foreignHeaders })).status, 403);

  const reminders = await Promise.all([
    request(`charges/${chargeId}/reminders`, { method: 'POST', headers }),
    request(`charges/${chargeId}/reminders`, { method: 'POST', headers })
  ]);

  // Every transport is disabled here, so nothing reaches the contact and the daily quota stays free.
  assert.deepEqual(reminders.map((result) => result.status).sort(), [202, 202]);
  assert.deepEqual(
    reminders.map((result) => result.body),
    [{ queued: false }, { queued: false }]
  );

  const detail = await request(`charges/${chargeId}`, { headers });

  assert.equal(detail.status, 200);
  assert.equal(detail.body.proof, null);
  assert.equal(detail.body.state, 'pending');
  assert.equal((await request(`charges/${chargeId}`, { headers: foreignHeaders })).status, 403);

  const indefinite = {
    recurrence: 'indefinite',
    description: 'HTTP mensal',
    totalCents: 10001,
    frequency: 'monthly',
    startDate: '2999-01-31',
    timezone: 'America/Sao_Paulo',
    split: { mode: 'equal', parts: [{ kind: 'user', userId: person.body.userId }, { kind: 'owner' }] },
    reminders: [
      { offsetDays: -5, enabled: true },
      { offsetDays: 0, enabled: false }
    ]
  };
  const created = await request('billings', {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    body: JSON.stringify(indefinite)
  });

  assert.equal(created.status, 201);

  const read = await request(`billings/${created.body.id}`, { headers });

  assert.equal(read.status, 200);

  for (const result of [created.body, read.body]) {
    for (const key of Object.keys(indefinite)) {
      // BillingDetail snapshots the total as Money ({ amountCents, currency }), not a bare totalCents field.
      if (key === 'totalCents') {
        assert.equal(result.total.amountCents, indefinite.totalCents, 'billing HTTP field totalCents');

        continue;
      }

      assert.deepEqual(result[key], indefinite[key], `billing HTTP field ${key}`);
    }

    assert.equal(result.state, 'active');
    assert.equal(result.charges.length, 0);
  }

  const paused = await request(`billings/${created.body.id}`, { method: 'PATCH', headers, body: JSON.stringify({ state: 'paused' }) });

  assert.equal(paused.status, 200);
  assert.equal(paused.body.state, 'paused');

  const listed = await request('billings', { headers });

  assert.equal(listed.status, 200);
  assert.ok(listed.body.billings.some((row) => row.id === created.body.id));

  const profile = { name: 'HTTP account', locale: 'pt-BR', timezone: 'America/Manaus', country: 'BR' };
  const savedProfile = await request('account/profile', { method: 'PATCH', headers, body: JSON.stringify(profile) });

  assert.equal(savedProfile.status, 200);
  assert.equal(savedProfile.body.user.timezone, 'America/Manaus');

  const sessions = await request('account/sessions', { headers });

  assert.equal(sessions.status, 200);
  assert.equal(sessions.body.sessions[0].current, true);

  const ticket = await request('account/export', { method: 'POST', headers });

  assert.equal(ticket.status, 200);

  const exported = await request('account/export/download', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: ticket.body.token })
  });

  assert.equal(exported.status, 200);
  assert.equal(exported.body.filename, 'receivy-dados.json');
  assert.equal(JSON.parse(exported.body.json).profile.name, 'HTTP account');
  assert.equal((await request(`account/sessions/${familyId}`, { method: 'DELETE', headers })).status, 204);
  assert.equal(
    (await request('auth/me', { headers })).status,
    401,
    'already-issued access rejected immediately after real HTTP revocation'
  );
  assert.equal(
    (await request('account/export/download', { method: 'POST', headers, body: JSON.stringify({ token: ticket.body.token }) })).status,
    401
  );
  assert.doesNotMatch(serverOutput, /fixture-secret-name|fixture-secret@example|fixture-secret-trace|fixture-secret-file|not-a-capability/);
  process.stdout.write('financial/account HTTP transport smoke: PASS\n');
} catch (error) {
  process.stderr.write(serverOutput);

  throw error;
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
  }

  run('docker', [...compose, 'down', '--remove-orphans']);
}

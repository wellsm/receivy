import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';

const cwd = new URL('..', import.meta.url).pathname;
const compose = ['compose', '-p', 'receivy-financial-http-smoke', '-f', 'docker-compose.http-smoke.yml'];
const apiBase = 'http://127.0.0.1:47365/http-smoke-receivy-api';
const jwtSecret = 'http-smoke-jwt-secret';
const familyId = '61111111-1111-4111-8111-111111111111';
let server;
let serverOutput = '';

function run(command, args) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
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
    if (server.exitCode !== null) throw new Error(`API exited before readiness\n${serverOutput}`);
    try {
      const health = await request('health');
      if (health.status === 200) return health;
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
      PUBLIC_LINK_HMAC_SECRET: 'http-smoke-public-link-secret',
      EMAIL_TRANSPORT: 'disabled',
      RESEND_API_KEY: 'disabled',
      RESEND_FROM_EMAIL: 'disabled@example.invalid',
      OAUTH_PROVIDERS_CONFIG_B64: 'disabled',
      OAUTH_REDIRECT_ALLOW_LIST: 'http://localhost:3000/auth/oauth/callback'
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
    `INSERT INTO users (id,email,name,locale,timezone,country,currency,created_at,updated_at) VALUES ('11111111-1111-4111-8111-111111111111','recurrence-http@example.invalid','HTTP fixture','pt-BR','America/Sao_Paulo','BR','BRL',now(),now()); INSERT INTO session_families (id,user_id,created_at,last_seen_at) VALUES ('${familyId}','11111111-1111-4111-8111-111111111111',now(),now())`
  ]);
  const authorization = `Bearer ${accessToken('11111111-1111-4111-8111-111111111111')}`;
  const invalidJson = await request('people', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json', 'x-trace-id': 'fixture-secret-trace' },
    body: '{"name":"fixture-secret-name","email":"fixture-secret@example.invalid",'
  });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.body.code, 'INVALID_REQUEST');
  assert.match(invalidJson.body.correlationId, /^[a-f0-9-]{36}$/);
  assert.equal(invalidJson.headers.get('x-trace-id'), invalidJson.body.correlationId);
  const malformed = await request('payment-methods', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ pixKeyType: 'cpf' })
  });
  assert.equal(malformed.status, 400);

  const invalidPix = await request('payment-methods', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({ pixKeyType: 'cpf', pixKey: '123' })
  });
  assert.equal(invalidPix.status, 400);
  assert.equal(invalidPix.body.code, 'INVALID_REQUEST');
  assert.equal(
    (
      await request('people', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Fixture', ownerId: familyId })
      })
    ).status,
    400
  );
  assert.equal((await request('public/charges/not-a-capability')).status, 404);
  // Disposable container-only fixture. Business behavior stays in DatabaseTester specs;
  // this assertion covers EZ4's real generated request/response serialization.
  const headers = { authorization, 'content-type': 'application/json' };
  const preferences = { emailEnabled: false, pushEnabled: true, reminderOffsets: [-3, 0, 2] };
  assert.equal((await request('notification-preferences')).status, 401);
  const savedPreferences = await request('notification-preferences', { method: 'PATCH', headers, body: JSON.stringify(preferences) });
  assert.equal(savedPreferences.status, 200);
  assert.deepEqual(savedPreferences.body, preferences);
  assert.deepEqual((await request('notification-preferences', { headers })).body, preferences);
  const registered = await request('devices', {
    method: 'POST',
    headers,
    body: JSON.stringify({ token: 'ExpoPushToken[http-fixture]', installationId: 'http-device', platform: 'ios' })
  });
  assert.equal(registered.status, 200);
  assert.deepEqual(Object.keys(registered.body).sort(), ['active', 'createdAt', 'id', 'platform']);
  assert.equal(registered.body.active, true);
  assert.equal(registered.body.platform, 'ios');
  const devicePage = await request('devices', { headers });
  assert.equal(devicePage.status, 200);
  assert.deepEqual(devicePage.body.devices, [registered.body]);
  assert.equal((await request(`devices/${registered.body.id}`, { method: 'DELETE', headers })).status, 204);
  const person = await request('people', { method: 'POST', headers, body: JSON.stringify({ name: 'Ana HTTP' }) });
  assert.equal(person.status, 201);
  const billing = await request('billings', {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': randomUUID() },
    body: JSON.stringify({
      type: 'once',
      totalCents: 1234,
      startDate: '2027-01-01',
      timezone: 'America/Sao_Paulo',
      split: { mode: 'fixed', parts: [{ kind: 'person', personId: person.body.id, amountCents: 1234 }] }
    })
  });
  assert.equal(billing.status, 201);
  const chargeId = billing.body.charges[0].id;
  const unavailableStorage = await request(`charges/${chargeId}/proofs/uploads`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ filename: 'fixture-secret-file.pdf', mime: 'application/pdf', size: 100 })
  });
  assert.equal(unavailableStorage.status, 500);
  assert.equal(unavailableStorage.body.code, 'INTERNAL_ERROR');
  assert.match(unavailableStorage.body.correlationId, /^[a-f0-9-]{36}$/);
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
    `INSERT INTO users (id,email,name,locale,timezone,country,currency,created_at,updated_at) VALUES ('22222222-2222-4222-8222-222222222222','foreign-http@example.invalid','Foreign fixture','pt-BR','America/Sao_Paulo','BR','BRL',now(),now()); INSERT INTO session_families (id,user_id,created_at,last_seen_at) VALUES ('${foreignFamilyId}','22222222-2222-4222-8222-222222222222',now(),now())`
  ]);
  const foreignHeaders = { ...headers, authorization: `Bearer ${accessToken('22222222-2222-4222-8222-222222222222', foreignFamilyId)}` };
  assert.equal((await request(`charges/${chargeId}/reminders`, { method: 'POST', headers: foreignHeaders })).status, 403);
  const reminders = await Promise.all([
    request(`charges/${chargeId}/reminders`, { method: 'POST', headers }),
    request(`charges/${chargeId}/reminders`, { method: 'POST', headers })
  ]);
  assert.deepEqual(reminders.map((result) => result.status).sort(), [202, 429]);
  assert.deepEqual(reminders.find((result) => result.status === 202).body, { queued: true });
  const deliveryId = randomUUID();
  // Narrow generated DTO fixture, not a substitute for the native delivery suite.
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
    `INSERT INTO notification_deliveries (id,event_id,charge_id,recipient_key,channel,template,state,render_inputs,body_hash,idempotency_key,attempts,available_at,created_at,updated_at) VALUES ('${deliveryId}','${randomUUID()}','${chargeId}','fixture','email','initial','disabled','{}','fixture','${randomUUID()}',0,now(),now(),now())`
  ]);
  const deliveries = await request(`charges/${chargeId}/deliveries`, { headers });
  assert.equal(deliveries.status, 200);
  const delivery = deliveries.body.deliveries.find((row) => row.id === deliveryId);
  assert.deepEqual(Object.keys(delivery).sort(), ['attempts', 'channel', 'id', 'reason', 'state', 'template', 'updatedAt']);
  assert.equal(delivery.state, 'disabled');
  assert.equal(delivery.attempts, 0);
  assert.equal(delivery.reason, null);
  assert.equal((await request(`charges/${chargeId}/deliveries`, { headers: foreignHeaders })).status, 403);
  const indefinite = {
    type: 'indefinite',
    description: 'HTTP mensal',
    totalCents: 10001,
    frequency: 'monthly',
    startDate: '2999-01-31',
    timezone: 'America/Sao_Paulo',
    split: { mode: 'equal', parts: [{ kind: 'person', personId: person.body.id }, { kind: 'owner' }] },
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
  const listed = await request('billings?type=indefinite', { headers });
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
  if (server && server.exitCode === null) server.kill('SIGTERM');
  run('docker', [...compose, 'down', '--remove-orphans']);
}

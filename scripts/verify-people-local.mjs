import assert from "node:assert/strict";
import { createHmac, randomInt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:3735/local-receivy-api";
const ids = [randomUUID(), randomUUID(), randomUUID()];
const emails = ids.map(id => `people-${id}@example.com`);
const scope = ids.map(id => `'${id}'`).join(",");
const sql = query => execFileSync("docker", ["exec", "receivy-pg", "psql", "-U", "receivy", "-d", "receivy", "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const localConfig = readFileSync(new URL("../packages/api/local.env.example", import.meta.url), "utf8");
const hashKey = /^LOGIN_CODE_HASH_KEY=(.*)$/m.exec(localConfig)[1];
const call = (path, token, method = "GET", body) => fetch(`${base}/${path}`, {
  method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

async function login(index) {
  const code = randomInt(0, 1000000).toString().padStart(6, "0");
  const hash = createHmac("sha256", hashKey).update(emails[index]).update("\0").update(code).digest("base64url");
  sql(`INSERT INTO login_codes (id,email,code_hash,attempts,expires_at,created_at)
    VALUES ('${randomUUID()}','${emails[index]}','${hash}',0,now()+interval '10 minutes',now());`);
  const response = await call("auth/email/confirm", null, "POST", { email: emails[index], code });
  assert.equal(response.status, 200, "Fixture email login");
  return (await response.json()).accessToken;
}

try {
  for (let i = 0; i < ids.length; i++) {
    sql(`INSERT INTO users (id,email,locale,timezone,country,currency,created_at,updated_at)
      VALUES ('${ids[i]}','${emails[i]}','pt-BR','America/Sao_Paulo','BR','BRL',now(),now());`);
  }
  const ownerA = await login(0);
  const ownerB = await login(1);
  assert.equal((await call("people")).status, 401);
  const input = { name: "  Ana  Silva ", email: emails[2].toUpperCase(), phone: "(11) 99999-1234" };
  assert.equal((await call("people", ownerA, "POST", { ...input, ownerId: ids[1] })).status, 400, "Client cannot supply an owner");
  const created = await call("people", ownerA, "POST", input);
  assert.equal(created.status, 201, "Create contact");
  const person = await created.json();
  assert.equal(person.name, "Ana Silva");
  assert.equal(person.email, emails[2]);
  assert.equal(person.phone, "+5511999991234");
  assert.equal("linkedUserId" in person, false);
  assert.equal((await (await call("people", ownerB)).json()).people.length, 0, "No cross-account list leak");
  assert.equal((await call(`people/${person.id}`, ownerB, "PATCH", input)).status, 404);
  assert.equal((await call(`people/${person.id}/archive`, ownerB, "POST")).status, 404);
  assert.equal((await call("people", ownerA, "POST", input)).status, 409);
  const races = await Promise.all([1, 2].map(() => call("people", ownerA, "POST", { name: "Concorrente", email: `race-${ids[0]}@example.com` })));
  assert.deepEqual(races.map(r => r.status).sort(), [201, 409], "Concurrent duplicates");

  assert.equal(sql(`SELECT count(*) FROM people WHERE id='${person.id}' AND linked_user_id IS NULL`), "1");
  await login(2);
  assert.equal(sql(`SELECT linked_user_id FROM people WHERE id='${person.id}'`), ids[2], "Verified email login links preexisting contact");
  const edited = await call(`people/${person.id}`, ownerA, "PATCH", { name: "Ana atualizada" });
  assert.equal(edited.status, 200);
  assert.equal((await edited.json()).email, null);
  assert.equal(sql(`SELECT count(*) FROM people WHERE id='${person.id}' AND linked_user_id IS NULL`), "1", "Removing email removes stale account link");
  const restored = await call(`people/${person.id}`, ownerA, "PATCH", input);
  assert.equal(restored.status, 200);
  assert.equal(sql(`SELECT linked_user_id FROM people WHERE id='${person.id}'`), ids[2], "Existing verified account links at edit");
  assert.equal((await call(`people/${person.id}/archive`, ownerA, "POST")).status, 204);
  assert.equal((await call(`people/${person.id}/archive`, ownerA, "POST")).status, 204, "Archive is idempotent");
  const archived = await (await call("people?archived=true", ownerA)).json();
  assert.equal(archived.people[0].email, emails[2], "Archive retains contact channel");
  assert.equal((await call("people", ownerA, "POST", input)).status, 201, "Archive releases active email");

  sql(`INSERT INTO people (id,owner_id,name,created_at,updated_at)
    SELECT gen_random_uuid(),'${ids[1]}','Contato ' || n,now(),now() FROM generate_series(1,52) AS n;`);
  const first = await (await call("people", ownerB)).json();
  const second = await (await call(`people?cursor=${first.nextCursor}`, ownerB)).json();
  assert.equal(first.people.length, 50);
  assert.equal(second.people.length, 2);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.people, ...second.people].map(p => p.id)).size, 52);
  console.log("People local: authenticated CRUD, cross-account isolation, concurrent uniqueness, verified linking, archive preservation and pagination passed.");
} finally {
  sql(`BEGIN;
    DELETE FROM person_contacts WHERE person_id IN (SELECT id FROM people WHERE owner_id IN (${scope}));
    DELETE FROM people WHERE owner_id IN (${scope});
    DELETE FROM refresh_tokens WHERE family_id IN (SELECT id FROM session_families WHERE user_id IN (${scope}));
    DELETE FROM session_families WHERE user_id IN (${scope});
    DELETE FROM auth_identities WHERE user_id IN (${scope});
    DELETE FROM login_codes WHERE email IN (${emails.map(email => `'${email}'`).join(",")});
    DELETE FROM users WHERE id IN (${scope});
    COMMIT;`);
  console.log("People local: only isolated fixtures removed.");
}

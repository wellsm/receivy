import { createPool } from '@ez4/pgclient/driver';

const TEST_DATABASE = 'receivy_tests';

if (process.env.APP_STAGE !== 'test') {
  throw new Error('Refusing to prepare the financial test database outside APP_STAGE=test.');
}

if (process.env.EZ4_RAW_PG_DB_URL) {
  throw new Error('Refusing an ambient EZ4_RAW_PG_DB_URL during financial integration tests.');
}

const connection = {
  host: process.env.EZ4_TEST_PG_HOST,
  port: Number(process.env.EZ4_TEST_PG_PORT),
  user: process.env.EZ4_TEST_PG_USER,
  password: process.env.EZ4_TEST_PG_PASSWORD,
  database: 'postgres'
};

if (!connection.host || !connection.user || connection.password === undefined || !Number.isInteger(connection.port)) {
  throw new Error('The explicit EZ4_TEST_PG_* connection is incomplete.');
}

if (!['127.0.0.1', '::1', 'localhost'].includes(connection.host)) {
  throw new Error('Refusing a non-loopback host for the dedicated test database.');
}

const pool = createPool(connection);

try {
  const existing = await pool.query('SELECT datname FROM pg_database WHERE datname = $1', [TEST_DATABASE]);

  if (existing.rowCount === 0) {
    await pool.query(`CREATE DATABASE ${TEST_DATABASE}`);

    process.stdout.write(`Created dedicated PostgreSQL database ${TEST_DATABASE}.\n`);
  }
} finally {
  await pool.end();
}

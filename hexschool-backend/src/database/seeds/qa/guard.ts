/**
 * Safety rail for the QA seeders.
 *
 * `hexschool-backend/.env` points `DATABASE_URL` at the **Neon dev database**.
 * The QA seeders are destructive by design — they purge and rebuild a demo
 * school so a browser-QA round can be re-run from a known state. Running them
 * against Neon would wipe shared dev data, so every QA entrypoint calls
 * `assertLocalDatabase()` before it touches anything.
 *
 * The allowed target is the local Docker Postgres from `docker-compose.yml`
 * (`postgres:5433`). Override with QA_ALLOW_DB_HOST only if you genuinely run
 * the QA stack somewhere else.
 */

const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function assertLocalDatabase(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error('DATABASE_URL is not set — refusing to run the QA seed.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL is not a parseable URL — refusing to run.');
  }

  const allowedHost = process.env.QA_ALLOW_DB_HOST;
  const hostOk = allowedHost
    ? url.hostname === allowedHost
    : ALLOWED_HOSTS.has(url.hostname);

  if (!hostOk) {
    throw new Error(
      [
        '',
        '  REFUSING TO RUN THE QA SEED — it is destructive and this is not a local database.',
        '',
        `    DATABASE_URL host : ${url.hostname}`,
        `    allowed           : ${allowedHost ?? [...ALLOWED_HOSTS].join(', ')}`,
        '',
        '  Run it against the local Docker Postgres instead:',
        '',
        '    docker compose up -d postgres redis minio mailpit',
        '    DATABASE_URL="postgresql://smis:smis@localhost:5433/smis" npm run seed:qa',
        '',
      ].join('\n'),
    );
  }

  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}

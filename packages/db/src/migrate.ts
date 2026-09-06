import type { SqlDatabase } from './sql.js';

export interface Migration {
  name: string;
  sql: string;
}

export function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) =>
      part
        .split(/\r?\n/)
        .filter((line) => !/^\s*--/.test(line))
        .join('\n')
        .trim(),
    )
    .filter((part) => part.length > 0);
}

export async function runSqlScript(db: SqlDatabase, sql: string): Promise<void> {
  for (const statement of splitStatements(sql)) {
    await db.execute(statement);
  }
}

export async function applyMigrations(
  db: SqlDatabase,
  migrations: readonly Migration[],
): Promise<string[]> {
  await db.execute(
    'CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );
  const applied = new Set(
    (await db.all<{ name: string }>('SELECT name FROM _migrations')).map((row) => row.name),
  );

  const ran: string[] = [];
  for (const migration of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    if (applied.has(migration.name)) continue;
    for (const statement of splitStatements(migration.sql)) {
      await db.execute(statement);
    }
    await db.execute('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)', [
      migration.name,
      new Date().toISOString(),
    ]);
    ran.push(migration.name);
  }
  return ran;
}

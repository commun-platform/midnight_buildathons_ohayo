import type { Client, InArgs } from '@libsql/client';

import type { SqlDatabase, SqlParameter, SqlStatement } from './sql.js';

function toArgs(parameters: readonly SqlParameter[]): InArgs {
  return parameters as unknown as InArgs;
}

export class LibSqlDatabase implements SqlDatabase {
  readonly kind = 'libsql';

  constructor(private readonly client: Client) {}

  async first<T>(sql: string, parameters: readonly SqlParameter[] = []): Promise<T | null> {
    const result = await this.client.execute({ sql, args: toArgs(parameters) });
    return (result.rows[0] as T | undefined) ?? null;
  }

  async all<T>(sql: string, parameters: readonly SqlParameter[] = []): Promise<T[]> {
    const result = await this.client.execute({ sql, args: toArgs(parameters) });
    return result.rows as unknown as T[];
  }

  async execute(sql: string, parameters: readonly SqlParameter[] = []): Promise<number> {
    const result = await this.client.execute({ sql, args: toArgs(parameters) });
    return Number(result.rowsAffected);
  }

  async batch(statements: readonly SqlStatement[]): Promise<void> {
    await this.client.batch(
      statements.map((statement) => ({
        sql: statement.sql,
        args: toArgs(statement.parameters ?? []),
      })),
      'write',
    );
  }

  close(): void {
    this.client.close();
  }
}

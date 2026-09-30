import type { SqlDatabase, SqlParameter, SqlStatement } from './sql.js';

export interface D1PreparedStatementLike {
  bind(...values: SqlParameter[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>;
}

export class D1SqlDatabase implements SqlDatabase {
  readonly kind = 'd1';

  constructor(private readonly database: D1DatabaseLike) {}

  private prepare(sql: string, parameters: readonly SqlParameter[]): D1PreparedStatementLike {
    const statement = this.database.prepare(sql);
    return parameters.length > 0 ? statement.bind(...parameters) : statement;
  }

  async first<T>(sql: string, parameters: readonly SqlParameter[] = []): Promise<T | null> {
    return this.prepare(sql, parameters).first<T>();
  }

  async all<T>(sql: string, parameters: readonly SqlParameter[] = []): Promise<T[]> {
    const result = await this.prepare(sql, parameters).all<T>();
    return result.results;
  }

  async execute(sql: string, parameters: readonly SqlParameter[] = []): Promise<number> {
    const result = await this.prepare(sql, parameters).run();
    return result.meta.changes;
  }

  async batch(statements: readonly SqlStatement[]): Promise<void> {
    await this.database.batch(
      statements.map(({ sql, parameters = [] }) => this.prepare(sql, parameters)),
    );
  }
}

export function d1Database(binding: D1DatabaseLike): SqlDatabase {
  return new D1SqlDatabase(binding);
}

/**
 * SQLite Adapter
 *
 * Thin wrapper over Node's built-in `node:sqlite` (`DatabaseSync`), exposed
 * through a small better-sqlite3-shaped interface so the rest of the codebase
 * is storage-agnostic.
 *
 * CodeGraph ships with a bundled Node runtime, so `node:sqlite` (real SQLite,
 * with WAL + FTS5) is always available — there is no native build step and no
 * wasm fallback. When run from source instead, it requires Node >= 22.5.
 */

export interface SqliteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  pragma(str: string, options?: { simple?: boolean }): any;
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T;
  close(): void;
  readonly open: boolean;
}

/**
 * The active SQLite backend. Only one now (`node:sqlite`); kept as a named type
 * so `codegraph status` and the per-instance reporting have a stable shape.
 */
export type SqliteBackend = "node-sqlite";

/**
 * Wraps Node's built-in `node:sqlite` (`DatabaseSync`) to match the
 * better-sqlite3 interface the rest of the code expects.
 *
 * node:sqlite is real SQLite compiled into Node, so it supports WAL, FTS5,
 * mmap, and `@named` params natively — the only shims needed are the
 * better-sqlite3 conveniences node:sqlite omits: a `.pragma()` helper, a
 * `.transaction()` helper, and `open` (node:sqlite exposes `isOpen`).
 */
class NodeSqliteAdapter implements SqliteDatabase {
  private _db: any;

  constructor(dbPath: string) {
    const { default: DataBase } = require('bun:sqlite');
    this._db = new DataBase(dbPath);
  }

  get open(): boolean {
    return this._db.isOpen;
  }

  /**
   * 移除 SQL 中所有字符串常量、标识符引用和注释，
   * 只留下纯骨架，避免误提取 @name。
   */
  private _stripSQLStringsAndComments(sql: string): string {
    let result = '';
    let i = 0;
    while (i < sql.length) {
      // 单引号字符串
      if (sql[i] === "'") {
        i++;
        while (i < sql.length) {
          if (sql[i] === "'") {
            if (i + 1 < sql.length && sql[i + 1] === "'") {
              i += 2; // 转义 ''
            } else {
              i++;
              break;
            }
          } else i++;
        }
        continue;
      }
      // 双引号标识符/字符串
      if (sql[i] === '"') {
        i++;
        while (i < sql.length) {
          if (sql[i] === '"') {
            if (i + 1 < sql.length && sql[i + 1] === '"') {
              i += 2;
            } else {
              i++;
              break;
            }
          } else i++;
        }
        continue;
      }
      // 单行注释 --
      if (sql[i] === '-' && i + 1 < sql.length && sql[i + 1] === '-') {
        i += 2;
        while (i < sql.length && sql[i] !== '\n') i++;
        continue;
      }
      // 多行注释 /* */
      if (sql[i] === '/' && i + 1 < sql.length && sql[i + 1] === '*') {
        i += 2;
        while (i < sql.length - 1 && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
        i += 2; // 跳过结束 */
        continue;
      }
      result += sql[i];
      i++;
    }
    return result;
  }

  /**
   * 提取 SQL 中**所有不重复**的命名参数（@name、:name、$name），
   * 保留它们在 SQL 中**首次出现**的顺序。
   */
  private _extractUniqueNamedParams(sql: string): string[] {
    const clean = this._stripSQLStringsAndComments(sql);
    const seen = new Set<string>();
    const result: string[] = [];
    const re = /[@:$]\w+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) {
      const name = m[0];
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }
    }
    return result;
  }

  prepare(sql: string): SqliteStatement {
    const stmt = this._db.prepare(sql);
    // 关键：使用去重后的参数名列表
    const paramNames = this._extractUniqueNamedParams(sql);
    const usesNamedParams = paramNames.length > 0;

    const toPositional = (args: any[]): any[] => {
      if (
        args.length === 1 &&
        typeof args[0] === 'object' &&
        args[0] !== null &&
        !Array.isArray(args[0]) &&
        usesNamedParams
      ) {
        const obj = args[0];
        return paramNames.map(name => {
          return obj[name] !== undefined ? obj[name] : obj[name.substring(1)];
        });
      }
      return args;
    };

    return {
      run(...params: any[]): { changes: number; lastInsertRowid: number | bigint } {
        const r = stmt.run(...toPositional(params));
        return {
          changes: Number(r?.changes ?? 0),
          lastInsertRowid: r?.lastInsertRowid ?? 0,
        };
      },
      get(...params: any[]): any {
        return stmt.get(...toPositional(params));
      },
      all(...params: any[]): any[] {
        return stmt.all(...toPositional(params));
      },
    };
  }

  exec(sql: string): void {
    this._db.exec(sql);
  }

  pragma(str: string, options?: { simple?: boolean }): any {
    const trimmed = str.trim();
    if (trimmed.includes('=')) {
      this._db.exec(`PRAGMA ${trimmed}`);
      return;
    }
    const row = this._db.prepare(`PRAGMA ${trimmed}`).get();
    if (options?.simple) {
      return row && typeof row === 'object' ? Object.values(row)[0] : row;
    }
    return row;
  }

  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
    return (...args: any[]) => {
      this._db.exec('BEGIN');
      try {
        const result = fn(...args);
        this._db.exec('COMMIT');
        return result;
      } catch (error) {
        this._db.exec('ROLLBACK');
        throw error;
      }
    };
  }

  close(): void {
    if (this._db.isOpen) this._db.close();
  }
}

/**
 * Create a database connection backed by `node:sqlite`.
 *
 * Returns the active backend alongside the db so each `DatabaseConnection` can
 * report it per-instance — MCP can open multiple project DBs in one process, so
 * a process-global would race.
 */
export function createDatabase(dbPath: string): {
  db: SqliteDatabase;
  backend: SqliteBackend;
} {
  try {
    return { db: new NodeSqliteAdapter(dbPath), backend: "node-sqlite" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Failed to open SQLite via the built-in node:sqlite module.\n" +
        "CodeGraph requires node:sqlite (Node.js 22.5+). Install the self-contained\n" +
        "CodeGraph release (it bundles a compatible Node), or run on Node 22.5+.\n" +
        `Underlying error: ${msg}`,
    );
  }
}

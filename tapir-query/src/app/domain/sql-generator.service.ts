import { Injectable } from "@angular/core";

export type SqlSortDirection = "asc" | "desc";

interface ClausePositions {
  where: number | null;
  groupBy: number | null;
  having: number | null;
  orderBy: number | null;
  limit: number | null;
  offset: number | null;
  fetch: number | null;
}

@Injectable({
  providedIn: "root",
})
export class SqlGeneratorService {
  withOrderBy(sql: string, columnName: string, direction: SqlSortDirection, fallbackTableName: string): string {
    const normalized = this.normalizeInputSql(sql, fallbackTableName);
    const { core, hadTerminator } = this.splitSqlTerminator(normalized);
    const withoutTopLevelOrderBy = this.removeTopLevelOrderByClause(core);
    const positions = this.findTopLevelClauses(withoutTopLevelOrderBy);
    const insertionPoint = this.firstClauseIndex([
      positions.limit,
      positions.offset,
      positions.fetch,
    ], withoutTopLevelOrderBy.length);

    const nextSql = this.insertClause(
      withoutTopLevelOrderBy,
      `ORDER BY ${this.escapeIdentifier(columnName)} ${direction.toUpperCase()}`,
      insertionPoint,
    );

    return this.withOptionalTerminator(nextSql, hadTerminator);
  }

  withFilterTemplate(sql: string, columnName: string, fallbackTableName: string): string {
    const normalized = this.normalizeInputSql(sql, fallbackTableName);
    const { core, hadTerminator } = this.splitSqlTerminator(normalized);
    const positions = this.findTopLevelClauses(core);
    const predicate = `${this.escapeIdentifier(columnName)} = 'value'`;

    if (positions.where !== null) {
      const whereClauseEnd = this.firstClauseAfter(
        positions.where,
        [positions.groupBy, positions.having, positions.orderBy, positions.limit, positions.offset, positions.fetch],
        core.length,
      );
      const currentWhereClause = core.slice(positions.where, whereClauseEnd).trimEnd();
      const nextSql = this.replaceSegment(core, positions.where, whereClauseEnd, `${currentWhereClause} AND ${predicate}`);
      return this.withOptionalTerminator(nextSql, hadTerminator);
    }

    const insertionPoint = this.firstClauseIndex(
      [positions.groupBy, positions.having, positions.orderBy, positions.limit, positions.offset, positions.fetch],
      core.length,
    );
    const nextSql = this.insertClause(core, `WHERE ${predicate}`, insertionPoint);
    return this.withOptionalTerminator(nextSql, hadTerminator);
  }

  private normalizeInputSql(sql: string, fallbackTableName: string): string {
    const trimmed = sql.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }

    return `SELECT * FROM ${this.escapeIdentifier(fallbackTableName)}`;
  }

  private splitSqlTerminator(sql: string): { core: string; hadTerminator: boolean } {
    const hadTerminator = /;\s*$/.test(sql);
    const core = sql.replace(/;+\s*$/, "").trim();

    return { core, hadTerminator };
  }

  private withOptionalTerminator(sql: string, hadTerminator: boolean): string {
    return hadTerminator ? `${sql};` : sql;
  }

  private removeTopLevelOrderByClause(sql: string): string {
    const positions = this.findTopLevelClauses(sql);
    if (positions.orderBy === null) {
      return sql;
    }

    const orderByEnd = this.firstClauseAfter(
      positions.orderBy,
      [positions.limit, positions.offset, positions.fetch],
      sql.length,
    );

    return this.replaceSegment(sql, positions.orderBy, orderByEnd, "");
  }

  private replaceSegment(sql: string, start: number, end: number, replacement: string): string {
    const before = sql.slice(0, start).trimEnd();
    const after = sql.slice(end).trimStart();
    const middle = replacement.trim();

    if (!before && !middle) {
      return after;
    }
    if (!after && !middle) {
      return before;
    }
    if (!before) {
      return `${middle} ${after}`.trim();
    }
    if (!after) {
      return `${before} ${middle}`.trim();
    }

    return `${before} ${middle} ${after}`.trim();
  }

  private insertClause(sql: string, clause: string, index: number): string {
    if (index <= 0) {
      return `${clause} ${sql.trimStart()}`.trim();
    }

    if (index >= sql.length) {
      return `${sql.trimEnd()} ${clause}`.trim();
    }

    const before = sql.slice(0, index).trimEnd();
    const after = sql.slice(index).trimStart();
    return `${before} ${clause} ${after}`.trim();
  }

  private firstClauseIndex(candidates: Array<number | null>, fallback: number): number {
    const indexes = candidates.filter((candidate): candidate is number => candidate !== null);
    if (indexes.length === 0) {
      return fallback;
    }

    return Math.min(...indexes);
  }

  private firstClauseAfter(start: number, candidates: Array<number | null>, fallback: number): number {
    const indexes = candidates.filter((candidate): candidate is number => candidate !== null && candidate > start);
    if (indexes.length === 0) {
      return fallback;
    }

    return Math.min(...indexes);
  }

  private findTopLevelClauses(sql: string): ClausePositions {
    const lower = sql.toLowerCase();
    const positions: ClausePositions = {
      where: null,
      groupBy: null,
      having: null,
      orderBy: null,
      limit: null,
      offset: null,
      fetch: null,
    };

    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let index = 0; index < sql.length; index += 1) {
      const current = sql[index] ?? "";
      const next = sql[index + 1] ?? "";

      if (inLineComment) {
        if (current === "\n") {
          inLineComment = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (current === "*" && next === "/") {
          inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (inSingleQuote) {
        if (current === "'" && next === "'") {
          index += 1;
          continue;
        }

        if (current === "'") {
          inSingleQuote = false;
        }

        continue;
      }

      if (inDoubleQuote) {
        if (current === '"' && next === '"') {
          index += 1;
          continue;
        }

        if (current === '"') {
          inDoubleQuote = false;
        }

        continue;
      }

      if (current === "-" && next === "-") {
        inLineComment = true;
        index += 1;
        continue;
      }

      if (current === "/" && next === "*") {
        inBlockComment = true;
        index += 1;
        continue;
      }

      if (current === "'") {
        inSingleQuote = true;
        continue;
      }

      if (current === '"') {
        inDoubleQuote = true;
        continue;
      }

      if (current === "(") {
        depth += 1;
        continue;
      }

      if (current === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (depth !== 0) {
        continue;
      }

      if (positions.where === null && this.keywordLengthAt(lower, index, "where") > 0) {
        positions.where = index;
        continue;
      }

      const groupByLength = this.keywordPairLengthAt(lower, index, "group", "by");
      if (positions.groupBy === null && groupByLength > 0) {
        positions.groupBy = index;
        index += groupByLength - 1;
        continue;
      }

      if (positions.having === null && this.keywordLengthAt(lower, index, "having") > 0) {
        positions.having = index;
        continue;
      }

      const orderByLength = this.keywordPairLengthAt(lower, index, "order", "by");
      if (positions.orderBy === null && orderByLength > 0) {
        positions.orderBy = index;
        index += orderByLength - 1;
        continue;
      }

      if (positions.limit === null && this.keywordLengthAt(lower, index, "limit") > 0) {
        positions.limit = index;
        continue;
      }

      if (positions.offset === null && this.keywordLengthAt(lower, index, "offset") > 0) {
        positions.offset = index;
        continue;
      }

      if (positions.fetch === null && this.keywordLengthAt(lower, index, "fetch") > 0) {
        positions.fetch = index;
      }
    }

    return positions;
  }

  private keywordLengthAt(sql: string, index: number, keyword: string): number {
    if (!sql.startsWith(keyword, index)) {
      return 0;
    }

    const before = sql[index - 1] ?? "";
    const after = sql[index + keyword.length] ?? "";
    if (this.isWordChar(before) || this.isWordChar(after)) {
      return 0;
    }

    return keyword.length;
  }

  private keywordPairLengthAt(sql: string, index: number, first: string, second: string): number {
    const firstLength = this.keywordLengthAt(sql, index, first);
    if (firstLength === 0) {
      return 0;
    }

    const secondIndex = this.skipWhitespace(sql, index + firstLength);
    const secondLength = this.keywordLengthAt(sql, secondIndex, second);
    if (secondLength === 0) {
      return 0;
    }

    return secondIndex + secondLength - index;
  }

  private skipWhitespace(sql: string, index: number): number {
    let cursor = index;
    while (cursor < sql.length && /\s/.test(sql[cursor] ?? "")) {
      cursor += 1;
    }
    return cursor;
  }

  private isWordChar(character: string): boolean {
    return /[a-z0-9_]/i.test(character);
  }

  private escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }
}

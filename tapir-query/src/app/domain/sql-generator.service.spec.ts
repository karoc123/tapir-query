import { TestBed } from "@angular/core/testing";
import { SqlGeneratorService } from "./sql-generator.service";

describe("SqlGeneratorService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it("inserts ORDER BY before a top-level LIMIT clause", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withOrderBy("SELECT * FROM transactions LIMIT 1000;", "amount", "asc", "transactions");

    expect(nextSql).toBe('SELECT * FROM transactions ORDER BY "amount" ASC LIMIT 1000;');
  });

  it("replaces only the top-level ORDER BY clause", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withOrderBy("SELECT * FROM (SELECT * FROM transactions ORDER BY created_at DESC) t ORDER BY currency DESC LIMIT 20", "currency", "asc", "transactions");

    expect(nextSql).toBe('SELECT * FROM (SELECT * FROM transactions ORDER BY created_at DESC) t ORDER BY "currency" ASC LIMIT 20');
  });

  it("adds a WHERE filter snippet before ORDER BY", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withFilterIntent(
      "SELECT * FROM transactions ORDER BY amount DESC",
      {
        columnName: "currency",
        value: "EUR",
        operator: "equals",
      },
      "transactions",
    );

    expect(nextSql).toBe("SELECT * FROM transactions WHERE \"currency\" = 'EUR' ORDER BY amount DESC");
  });

  it("appends filter predicate to an existing WHERE clause", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withFilterTemplate("SELECT currency, COUNT(*) FROM transactions WHERE amount > 0 GROUP BY currency", "currency", "transactions");

    expect(nextSql).toBe("SELECT currency, COUNT(*) FROM transactions WHERE amount > 0 AND (\"currency\" = 'value') GROUP BY currency");
  });

  it("merges FilterIntent into a query with JOIN + WHERE without disturbing ORDER BY", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withFilterIntent(
      "SELECT t.id, c.name FROM transactions t LEFT JOIN customers c ON c.id = t.customer_id WHERE t.amount > 100 ORDER BY t.id DESC",
      {
        columnName: "c.name",
        value: "acme",
        operator: "contains",
      },
      "transactions",
    );

    expect(nextSql).toContain('WHERE t.amount > 100 AND (CAST("c"."name" AS VARCHAR) ILIKE \'%acme%\'');
    expect(nextSql).toContain("ORDER BY t.id DESC");
  });

  it("inserts WHERE before GROUP BY when no WHERE exists", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withFilterIntent(
      "SELECT currency, COUNT(*) FROM transactions GROUP BY currency HAVING COUNT(*) > 2",
      {
        columnName: "currency",
        value: "USD",
        operator: "equals",
      },
      "transactions",
    );

    expect(nextSql).toBe("SELECT currency, COUNT(*) FROM transactions WHERE \"currency\" = 'USD' GROUP BY currency HAVING COUNT(*) > 2");
  });

  it("escapes LIKE wildcards and quotes for contains operator", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withFilterIntent(
      "SELECT * FROM transactions",
      {
        columnName: "note",
        value: "100%_owner's",
        operator: "contains",
      },
      "transactions",
    );

    expect(nextSql).toContain("ILIKE '%100\\%\\_owner''s%' ESCAPE '\\'");
  });

  it("does not throw on malformed SQL input", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const runMalformedTransform = (): string =>
      service.withFilterIntent(
        "SELECT FROM",
        {
          columnName: "amount",
          value: "10",
          operator: "greaterThan",
        },
        "transactions",
      );

    expect(runMalformedTransform).not.toThrow();
    expect(runMalformedTransform()).toContain("WHERE");
  });

  it("falls back to a table query when input SQL is empty", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withOrderBy("", "amount", "desc", "transactions");

    expect(nextSql).toBe('SELECT * FROM "transactions" ORDER BY "amount" DESC');
  });
});

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

    const nextSql = service.withFilterTemplate("SELECT * FROM transactions ORDER BY amount DESC", "currency", "transactions");

    expect(nextSql).toBe("SELECT * FROM transactions WHERE \"currency\" = 'value' ORDER BY amount DESC");
  });

  it("appends filter predicate to an existing WHERE clause", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withFilterTemplate("SELECT currency, COUNT(*) FROM transactions WHERE amount > 0 GROUP BY currency", "currency", "transactions");

    expect(nextSql).toBe("SELECT currency, COUNT(*) FROM transactions WHERE amount > 0 AND \"currency\" = 'value' GROUP BY currency");
  });

  it("falls back to a table query when input SQL is empty", () => {
    const service = TestBed.inject(SqlGeneratorService);

    const nextSql = service.withOrderBy("", "amount", "desc", "transactions");

    expect(nextSql).toBe('SELECT * FROM "transactions" ORDER BY "amount" DESC');
  });
});

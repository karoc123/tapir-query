import { TestBed } from "@angular/core/testing";
import { ErrorParsingService } from "./error-parsing.service";

describe("ErrorParsingService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it("extracts a clean summary and SQL line context", () => {
    const service = TestBed.inject(ErrorParsingService);

    const parsed = service.parse(
      `sql error: Parser Error: syntax error at or near "Name"\nLINE 1: SELECT Customer Name FROM orders\n                        ^`,
    );

    expect(parsed.summary).toBe("syntax error at or near 'Name'");
    expect(parsed.sqlContext).toContain("LINE 1:");
    expect(parsed.sqlContext).toContain("^");
  });

  it("falls back to the first non-empty line when parser metadata is missing", () => {
    const service = TestBed.inject(ErrorParsingService);

    const parsed = service.parse(new Error("Connection refused while executing query"));

    expect(parsed.summary).toBe("Connection refused while executing query");
    expect(parsed.sqlContext).toBeNull();
  });
});

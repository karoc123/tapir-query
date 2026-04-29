import { TestBed } from "@angular/core/testing";
import { QueryService } from "./query.service";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";
import { MockTauriService } from "../testing/mock-tauri.service";

describe("QueryService", () => {
  const bridgeMock = new MockTauriService();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: TauriBridgeService, useValue: bridgeMock }],
    });
  });

  afterEach(() => {
    bridgeMock.reset();
    localStorage.removeItem("tapir.queryHistory.v1");
  });

  it("persists successful queries in history", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");

    expect(service.queryHistory()[0]).toBe("SELECT * FROM transactions");
    expect(JSON.parse(localStorage.getItem("tapir.queryHistory.v1") ?? "[]")[0]).toBe(
      "SELECT * FROM transactions",
    );
  });

  it("exports the active SQL result through backend export_csv", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    await service.exportCsv("exports/query-results.csv");

    expect(bridgeMock.exportCsvCalls[0]).toEqual({
      sql: "SELECT * FROM transactions",
      outputPath: "exports/query-results.csv",
    });
  });

  it("sorts full dataset by selected column and stores active sort state", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    await service.sortByEntireTableColumn("amount", "asc");

    expect(bridgeMock.executeQueryCalls[1]).toEqual({
      sql: 'SELECT * FROM "transactions" ORDER BY "amount" ASC',
      limit: 500,
      offset: 0,
    });
    expect(service.activeSortColumn()).toBe("amount");
    expect(service.activeSortDirection()).toBe("asc");
  });

  it("clears active sorting when user runs a new query", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    await service.sortByEntireTableColumn("amount", "desc");

    service.updateQuery("SELECT currency, COUNT(*) FROM transactions GROUP BY currency");
    await service.runQuery();

    expect(service.activeSortColumn()).toBeNull();
    expect(service.activeSortDirection()).toBeNull();
    expect(bridgeMock.executeQueryCalls[2]).toEqual({
      sql: "SELECT currency, COUNT(*) FROM transactions GROUP BY currency",
      limit: 500,
      offset: 0,
    });
  });
});

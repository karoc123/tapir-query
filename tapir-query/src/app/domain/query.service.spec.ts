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

    expect(service.queryHistory()[0]).toBe("SELECT * FROM transactions LIMIT 1000");
    expect(JSON.parse(localStorage.getItem("tapir.queryHistory.v1") ?? "[]")[0]).toBe("SELECT * FROM transactions LIMIT 1000");
  });

  it("exports the active SQL result through backend export_csv", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    await service.exportCsv("exports/query-results.csv");

    expect(bridgeMock.exportCsvCalls[0]).toEqual({
      sql: "SELECT * FROM transactions LIMIT 1000",
      outputPath: "exports/query-results.csv",
    });
  });

  it("sorts full dataset by selected column and stores active sort state", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    await service.sortByEntireTableColumn("amount", "asc");

    expect(bridgeMock.startQuerySessionCalls[1]).toEqual({
      sql: 'SELECT * FROM transactions ORDER BY "amount" ASC LIMIT 1000',
    });
    expect(bridgeMock.readQuerySessionChunkCalls[1]).toEqual({
      sessionId: "session-1",
      limit: 1000,
      offset: 0,
    });
    expect(bridgeMock.closeQuerySessionCalls[0]).toEqual({
      sessionId: "session-1",
    });
    expect(bridgeMock.executeQueryCalls).toEqual([]);
    expect(service.totalRowCount()).toBe(1);
    expect(service.windowStartOffset()).toBe(0);
    expect(service.rows().length).toBe(1);
    expect(service.activeSortColumn()).toBe("amount");
    expect(service.activeSortDirection()).toBe("asc");
    expect(service.query()).toBe('SELECT * FROM transactions ORDER BY "amount" ASC LIMIT 1000');
  });

  it("runs simple COUNT queries through direct execution path", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    service.updateQuery('SELECT count(*) FROM "transactions" WHERE "currency" = \'EUR\'');
    await service.runQuery();

    expect(bridgeMock.executeQueryCalls[0]).toEqual({
      sql: 'SELECT count(*) FROM "transactions" WHERE "currency" = \'EUR\'',
      limit: 1000,
      offset: 0,
    });
    expect(bridgeMock.startQuerySessionCalls.length).toBe(1);
  });

  it("clears active sorting when user runs a new query", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    await service.sortByEntireTableColumn("amount", "desc");

    service.updateQuery("SELECT currency, COUNT(*) FROM transactions GROUP BY currency");
    await service.runQuery();

    expect(service.activeSortColumn()).toBeNull();
    expect(service.activeSortDirection()).toBeNull();
    expect(bridgeMock.startQuerySessionCalls[1]).toEqual({
      sql: 'SELECT * FROM transactions ORDER BY "amount" DESC LIMIT 1000',
    });
    expect(bridgeMock.startQuerySessionCalls[2]).toEqual({
      sql: "SELECT currency, COUNT(*) FROM transactions GROUP BY currency",
    });
    expect(bridgeMock.readQuerySessionChunkCalls[2]).toEqual({
      sessionId: "session-1",
      limit: 1000,
      offset: 0,
    });
  });

  it("inserts a filter template into the editor SQL without running a query", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    service.applyFilterTemplate("currency");

    expect(service.query()).toBe("SELECT * FROM transactions WHERE \"currency\" = 'value' LIMIT 1000");
    expect(bridgeMock.startQuerySessionCalls.length).toBe(1);
  });
});

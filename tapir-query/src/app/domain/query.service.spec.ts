import { TestBed } from "@angular/core/testing";
import { HistoryService } from "./history.service";
import { QueryExecutionEventsService } from "./query-execution-events.service";
import { QueryService } from "./query.service";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";
import { MockTauriService } from "../testing/mock-tauri.service";

describe("QueryService", () => {
  let bridgeMock: MockTauriService;
  let queryExecutionEvents: QueryExecutionEventsService;

  function flushEffects(): void {
    const maybeFlushEffects = (TestBed as unknown as { flushEffects?: () => void }).flushEffects;
    if (typeof maybeFlushEffects === "function") {
      maybeFlushEffects();
    }
  }

  beforeEach(() => {
    bridgeMock = new MockTauriService();
    queryExecutionEvents = new QueryExecutionEventsService();

    TestBed.configureTestingModule({
      providers: [
        { provide: TauriBridgeService, useValue: bridgeMock },
        { provide: QueryExecutionEventsService, useValue: queryExecutionEvents },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("captures successful preview query in persistent history service", async () => {
    const service = TestBed.inject(QueryService);
    const historyService = TestBed.inject(HistoryService);

    await service.openFile("/tmp/transactions.csv");
    flushEffects();
    await Promise.resolve();

    expect(historyService.entries()[0]).toEqual(
      expect.objectContaining({
        sql: "SELECT * FROM transactions LIMIT 1000",
      }),
    );
    expect(bridgeMock.saveQueryHistoryCalls[0]?.entries[0]?.sql).toBe("SELECT * FROM transactions LIMIT 1000");
  });

  it("does not capture failed queries in history", async () => {
    const service = TestBed.inject(QueryService);
    const historyService = TestBed.inject(HistoryService);

    await service.openFile("/tmp/transactions.csv");
    flushEffects();
    await Promise.resolve();

    const baselineEntries = historyService.entries().length;
    bridgeMock.executeQueryImpl = async () => {
      throw new Error("sql error: syntax error at or near 'FROM'");
    };

    service.updateQuery("SELECT FROM");
    await service.runQuery();
    flushEffects();
    await Promise.resolve();

    expect(historyService.entries().length).toBe(baselineEntries);
    expect(historyService.entries().some((entry) => entry.sql === "SELECT FROM")).toBe(false);
    expect(service.effectiveSql()).toBeNull();
  });

  it("uses direct preview execution when opening a file", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");

    expect(bridgeMock.executeQueryCalls[0]).toEqual({
      sql: "SELECT * FROM transactions LIMIT 1000",
      limit: 1000,
      offset: 0,
    });
    expect(bridgeMock.startQuerySessionCalls.length).toBe(0);
    expect(bridgeMock.readQuerySessionChunkCalls.length).toBe(0);
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

    expect(bridgeMock.startQuerySessionCalls.length).toBe(0);
    expect(bridgeMock.readQuerySessionChunkCalls.length).toBe(0);
    expect(bridgeMock.closeQuerySessionCalls).toEqual([]);
    expect(bridgeMock.executeQueryCalls[0]).toEqual({
      sql: "SELECT * FROM transactions LIMIT 1000",
      limit: 1000,
      offset: 0,
    });
    expect(bridgeMock.executeQueryCalls[1]).toEqual({
      sql: 'SELECT * FROM transactions ORDER BY "amount" ASC LIMIT 1000',
      limit: 1000,
      offset: 0,
    });
    expect(service.totalRowCount()).toBe(1);
    expect(service.windowStartOffset()).toBe(0);
    expect(service.rows().length).toBe(1);
    expect(service.activeSortColumn()).toBe("amount");
    expect(service.activeSortDirection()).toBe("asc");
    expect(service.hasActiveSession()).toBe(false);
    expect(service.query()).toBe('SELECT * FROM transactions ORDER BY "amount" ASC LIMIT 1000');
  });

  it("sorts based on effective SQL instead of unsaved editor text", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    service.updateQuery('SELECT count(*) FROM "transactions"');

    await service.sortByEntireTableColumn("amount", "asc");

    expect(bridgeMock.executeQueryCalls[1]).toEqual({
      sql: 'SELECT * FROM transactions ORDER BY "amount" ASC LIMIT 1000',
      limit: 1000,
      offset: 0,
    });
    expect(service.query()).toBe('SELECT * FROM transactions ORDER BY "amount" ASC LIMIT 1000');
  });

  it("runs non-COUNT queries through direct execution", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    service.updateQuery("SELECT currency, COUNT(*) FROM transactions GROUP BY currency");

    await service.runQuery();

    expect(bridgeMock.executeQueryCalls[1]).toEqual({
      sql: "SELECT currency, COUNT(*) FROM transactions GROUP BY currency",
      limit: 1000,
      offset: 0,
    });
    expect(bridgeMock.startQuerySessionCalls.length).toBe(0);
    expect(bridgeMock.readQuerySessionChunkCalls.length).toBe(0);
    expect(service.rows().length).toBe(1);
    expect(service.activeSortColumn()).toBeNull();
    expect(service.activeSortDirection()).toBeNull();
    expect(service.hasActiveSession()).toBe(false);
  });

  it("runs simple COUNT queries through direct execution path", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    service.updateQuery('SELECT count(*) FROM "transactions" WHERE "currency" = \'EUR\'');
    await service.runQuery();

    expect(bridgeMock.executeQueryCalls[1]).toEqual({
      sql: 'SELECT count(*) FROM "transactions" WHERE "currency" = \'EUR\'',
      limit: 1000,
      offset: 0,
    });
    expect(bridgeMock.startQuerySessionCalls.length).toBe(0);
  });

  it("clears active sorting when user runs a new query", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    await service.sortByEntireTableColumn("amount", "desc");

    service.updateQuery("SELECT currency, COUNT(*) FROM transactions GROUP BY currency");
    await service.runQuery();

    expect(service.activeSortColumn()).toBeNull();
    expect(service.activeSortDirection()).toBeNull();
    expect(bridgeMock.executeQueryCalls[1]).toEqual({
      sql: 'SELECT * FROM transactions ORDER BY "amount" DESC LIMIT 1000',
      limit: 1000,
      offset: 0,
    });
    expect(bridgeMock.executeQueryCalls[2]).toEqual({
      sql: "SELECT currency, COUNT(*) FROM transactions GROUP BY currency",
      limit: 1000,
      offset: 0,
    });
    expect(bridgeMock.startQuerySessionCalls.length).toBe(0);
    expect(bridgeMock.readQuerySessionChunkCalls.length).toBe(0);
  });

  it("inserts a filter template into the editor SQL without running a query", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    service.applyFilterTemplate("currency");

    expect(service.query()).toBe("SELECT * FROM transactions WHERE \"currency\" = 'value' LIMIT 1000");
    expect(bridgeMock.startQuerySessionCalls.length).toBe(0);
  });

  it("merges filter intent with operator and value into SQL", async () => {
    const service = TestBed.inject(QueryService);

    await service.openFile("/tmp/transactions.csv");
    service.applyFilterIntent({
      columnName: "currency",
      value: "EUR",
      operator: "equals",
    });

    expect(service.query()).toBe("SELECT * FROM transactions WHERE \"currency\" = 'EUR' LIMIT 1000");
  });
});

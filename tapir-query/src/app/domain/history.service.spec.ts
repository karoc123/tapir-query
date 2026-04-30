import { TestBed } from "@angular/core/testing";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";
import { MockTauriService } from "../testing/mock-tauri.service";
import { HistoryService } from "./history.service";
import { QueryExecutionEventsService } from "./query-execution-events.service";

describe("HistoryService", () => {
  let bridgeMock: MockTauriService;
  let queryExecutionEvents: QueryExecutionEventsService;

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

  async function flushAsyncWork(): Promise<void> {
    const flushEffects = (TestBed as unknown as { flushEffects?: () => void }).flushEffects;
    if (typeof flushEffects === "function") {
      flushEffects();
    }

    await Promise.resolve();
    await Promise.resolve();

    if (typeof flushEffects === "function") {
      flushEffects();
    }
  }

  it("deduplicates history and moves repeated query to top", async () => {
    const service = TestBed.inject(HistoryService);
    const queryExecutionEvents = TestBed.inject(QueryExecutionEventsService);

    await flushAsyncWork();

    queryExecutionEvents.emitSuccessfulExecution("SELECT * FROM transactions");
    queryExecutionEvents.emitSuccessfulExecution("SELECT COUNT(*) FROM transactions");
    queryExecutionEvents.emitSuccessfulExecution("SELECT * FROM transactions");

    await flushAsyncWork();

    expect(service.entries().map((entry) => entry.sql)).toEqual(["SELECT * FROM transactions", "SELECT COUNT(*) FROM transactions"]);
  });

  it("enforces history limit of 50 entries", async () => {
    const service = TestBed.inject(HistoryService);
    const queryExecutionEvents = TestBed.inject(QueryExecutionEventsService);

    await flushAsyncWork();

    for (let index = 0; index < 55; index += 1) {
      queryExecutionEvents.emitSuccessfulExecution(`SELECT ${index}`);
    }

    await flushAsyncWork();

    const entries = service.entries();
    expect(entries).toHaveLength(50);
    expect(entries[0]?.sql).toBe("SELECT 54");
    expect(entries[49]?.sql).toBe("SELECT 5");
  });

  it("ignores invalid queries so history stays clean", async () => {
    const service = TestBed.inject(HistoryService);
    const queryExecutionEvents = TestBed.inject(QueryExecutionEventsService);

    await flushAsyncWork();

    queryExecutionEvents.emitSuccessfulExecution("     ");
    queryExecutionEvents.emitSuccessfulExecution("\n\t");
    queryExecutionEvents.emitSuccessfulExecution("SELECT 1");

    await flushAsyncWork();

    expect(service.entries().map((entry) => entry.sql)).toEqual(["SELECT 1"]);
  });

  it("sanitizes loaded history payloads from backend", async () => {
    bridgeMock.queryHistoryResult = {
      entries: [
        {
          sql: "  SELECT * FROM dataset  ",
          executedAtUnixMs: 120,
        },
        {
          sql: "",
          executedAtUnixMs: 121,
        },
        {
          sql: "SELECT * FROM dataset",
          executedAtUnixMs: 122,
        },
        {
          sql: "SELECT 2",
          executedAtUnixMs: Number.NaN,
        },
      ],
    };

    const service = TestBed.inject(HistoryService);

    await flushAsyncWork();

    expect(service.entries()).toHaveLength(2);
    expect(service.entries()[0]?.sql).toBe("SELECT * FROM dataset");
    expect(service.entries()[1]?.sql).toBe("SELECT 2");
  });
});

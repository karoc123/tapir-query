/// <reference types="jest" />

import { TestBed } from "@angular/core/testing";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";
import { QueryChunk } from "../infrastructure/tauri-contracts";
import { MockTauriService } from "../testing/mock-tauri.service";
import { DatasetMetricsService } from "./dataset-metrics.service";

const flushPromises = async (): Promise<void> => {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
};

const countChunk = (count: string): QueryChunk => ({
  columns: ["tapir_count"],
  rows: [{ tapir_count: count }],
  limit: 1,
  offset: 0,
  nextOffset: null,
  elapsedMs: 1,
});

describe("DatasetMetricsService", () => {
  const bridgeMock = new MockTauriService();

  beforeEach(() => {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [{ provide: TauriBridgeService, useValue: bridgeMock }],
    });
  });

  afterEach(() => {
    bridgeMock.reset();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("runs filtered and total COUNT queries in the background", async () => {
    bridgeMock.executeQueryResults = [countChunk("42"), countChunk("120")];

    const service = TestBed.inject(DatasetMetricsService);
    service.refresh("SELECT * FROM transactions WHERE amount > 100", "transactions");

    expect(service.filteredPending()).toBe(true);
    expect(service.totalPending()).toBe(true);

    jest.runOnlyPendingTimers();
    await flushPromises();

    expect(bridgeMock.executeQueryCalls[0]?.sql).toBe('SELECT COUNT(*) AS "tapir_count" FROM (SELECT * FROM transactions WHERE amount > 100) AS tapir_filtered');
    expect(bridgeMock.executeQueryCalls[1]?.sql).toBe('SELECT COUNT(*) AS "tapir_count" FROM "transactions"');
    expect(service.filteredCount()).toBe(42);
    expect(service.totalCount()).toBe(120);
    expect(service.rowStatusLabel()).toBe("42 of 120 Rows");
  });

  it("skips COUNT queries for LIMIT-based preview SQL", async () => {
    const service = TestBed.inject(DatasetMetricsService);
    service.refresh("SELECT * FROM transactions LIMIT 1000", "transactions");

    jest.runOnlyPendingTimers();
    await flushPromises();

    expect(bridgeMock.executeQueryCalls).toEqual([]);
    expect(service.hasActiveSignature()).toBe(false);
    expect(service.totalPending()).toBe(false);
  });

  it("disables background COUNT queries in Tauri runtime", async () => {
    (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"] = {};

    try {
      const service = TestBed.inject(DatasetMetricsService);
      service.refresh("SELECT * FROM transactions", "transactions");

      jest.runOnlyPendingTimers();
      await flushPromises();

      expect(bridgeMock.executeQueryCalls).toEqual([]);
      expect(service.hasActiveSignature()).toBe(false);
      expect(service.rowStatusLabel()).toBe("0 of 0 Rows");
    } finally {
      delete (window as unknown as Record<string, unknown>)["__TAURI_INTERNALS__"];
    }
  });

  it("caps very large counts at Number.MAX_SAFE_INTEGER and marks overflow in labels", async () => {
    bridgeMock.executeQueryResults = [countChunk("90071992547409930"), countChunk("90071992547409931")];

    const service = TestBed.inject(DatasetMetricsService);
    service.refresh("SELECT * FROM transactions", "transactions");

    jest.runOnlyPendingTimers();
    await flushPromises();

    expect(service.filteredCount()).toBe(Number.MAX_SAFE_INTEGER);
    expect(service.totalCount()).toBe(Number.MAX_SAFE_INTEGER);
    expect(service.rowStatusLabel()).toContain("+");
  });
});

/// <reference types="jest" />

import { TestBed } from "@angular/core/testing";
import { TauriBridgeService } from "../infrastructure/tauri-bridge.service";
import { ColumnProfileMetricResult } from "../infrastructure/tauri-contracts";
import { MockTauriService } from "../testing/mock-tauri.service";
import { DataAnalysisPluginService } from "./data-analysis-plugin.service";

const flushPromises = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((reason: unknown) => void) | null = null;

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  if (!resolve || !reject) {
    throw new Error("Failed to create deferred promise");
  }

  return {
    promise,
    resolve,
    reject,
  };
};

const cardinalityResult = (columnName: string): ColumnProfileMetricResult => ({
  columnName,
  metric: "cardinalityTopValues",
  elapsedMs: 9,
  totalRows: 6,
  cardinalityTopValues: [
    { value: "ACME", frequency: 3 },
    { value: "BETA", frequency: 2 },
  ],
  uniqueValueCount: 2,
  completeness: null,
  stringLengthHistogram: null,
});

const completenessResult = (columnName: string, ratio: number): ColumnProfileMetricResult => ({
  columnName,
  metric: "completenessAudit",
  elapsedMs: 5,
  totalRows: 12,
  cardinalityTopValues: null,
  uniqueValueCount: null,
  completeness: {
    populated: 4,
    emptyOrNull: 8,
    completenessRatio: ratio,
  },
  stringLengthHistogram: null,
});

const lengthResult = (columnName: string): ColumnProfileMetricResult => ({
  columnName,
  metric: "stringLengthHistogram",
  elapsedMs: 11,
  totalRows: 6,
  cardinalityTopValues: null,
  uniqueValueCount: null,
  completeness: null,
  stringLengthHistogram: {
    nonEmptyRows: 6,
    minLength: 2,
    maxLength: 14,
    averageLength: 8.33,
    buckets: [
      { label: "1-4", minInclusive: 1, maxInclusive: 4, frequency: 1 },
      { label: "5-8", minInclusive: 5, maxInclusive: 8, frequency: 3 },
      { label: "9-16", minInclusive: 9, maxInclusive: 16, frequency: 2 },
      { label: "17-32", minInclusive: 17, maxInclusive: 32, frequency: 0 },
      { label: "33-64", minInclusive: 33, maxInclusive: 64, frequency: 0 },
      { label: "65-128", minInclusive: 65, maxInclusive: 128, frequency: 0 },
      { label: "129+", minInclusive: 129, maxInclusive: null, frequency: 0 },
    ],
  },
});

describe("DataAnalysisPluginService", () => {
  const bridgeMock = new MockTauriService();

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: TauriBridgeService, useValue: bridgeMock }],
    });
  });

  afterEach(() => {
    bridgeMock.reset();
  });

  it("updates metric cards incrementally as each async result arrives", async () => {
    const service = TestBed.inject(DataAnalysisPluginService);
    const completenessDeferred = createDeferred<ColumnProfileMetricResult>();
    const cardinalityDeferred = createDeferred<ColumnProfileMetricResult>();
    const lengthDeferred = createDeferred<ColumnProfileMetricResult>();

    bridgeMock.runColumnProfileMetricImpl = async (payload) => {
      if (payload.metric === "completenessAudit") {
        return await completenessDeferred.promise;
      }
      if (payload.metric === "cardinalityTopValues") {
        return await cardinalityDeferred.promise;
      }
      return await lengthDeferred.promise;
    };

    service.enable();
    service.refresh({
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [{ name: "partner", dataType: "VARCHAR" }],
    });

    expect(service.running()).toBe(true);
    expect(service.totalTasks()).toBe(3);
    expect(service.columnProfiles()[0]?.completeness.status).toBe("loading");
    expect(service.columnProfiles()[0]?.cardinality.status).toBe("loading");
    expect(service.columnProfiles()[0]?.stringLength.status).toBe("loading");

    completenessDeferred.resolve(completenessResult("partner", 0.75));
    await flushPromises();

    expect(service.completedTasks()).toBe(1);
    expect(service.columnProfiles()[0]?.completeness.status).toBe("ready");
    expect(service.columnProfiles()[0]?.cardinality.status).toBe("loading");
    expect(service.columnProfiles()[0]?.stringLength.status).toBe("loading");

    cardinalityDeferred.resolve(cardinalityResult("partner"));
    await flushPromises();

    expect(service.completedTasks()).toBe(2);
    expect(service.columnProfiles()[0]?.cardinality.status).toBe("ready");
    expect(service.columnProfiles()[0]?.stringLength.status).toBe("loading");

    lengthDeferred.resolve(lengthResult("partner"));
    await flushPromises();

    expect(service.running()).toBe(false);
    expect(service.completedTasks()).toBe(3);
    expect(service.progressLabel()).toBe("3 / 3 metrics");
    expect(service.columnProfiles()[0]?.stringLength.status).toBe("ready");
    expect(bridgeMock.runColumnProfileMetricCalls.map((call) => call.metric)).toEqual(["completenessAudit", "cardinalityTopValues", "stringLengthHistogram"]);
  });

  it("preserves backend precision for completeness ratios", async () => {
    const service = TestBed.inject(DataAnalysisPluginService);

    bridgeMock.runColumnProfileMetricImpl = async (payload) => {
      if (payload.metric === "completenessAudit") {
        return completenessResult(payload.columnName, 0.333333);
      }
      if (payload.metric === "cardinalityTopValues") {
        return cardinalityResult(payload.columnName);
      }
      return lengthResult(payload.columnName);
    };

    service.enable();
    service.refresh({
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [{ name: "partner", dataType: "VARCHAR" }],
    });

    await flushPromises();

    const column = service.columnProfiles()[0];
    expect(column).toBeDefined();
    expect(column?.totalRows).toBe(12);
    expect(column?.completeness.status).toBe("ready");
    expect(column?.completeness.value?.completenessRatio).toBeCloseTo(0.333333, 6);
  });

  it("does not schedule duplicate runs for unchanged active signature", async () => {
    const service = TestBed.inject(DataAnalysisPluginService);

    bridgeMock.runColumnProfileMetricImpl = async (payload) => {
      if (payload.metric === "completenessAudit") {
        return completenessResult(payload.columnName, 0.8);
      }
      if (payload.metric === "cardinalityTopValues") {
        return cardinalityResult(payload.columnName);
      }
      return lengthResult(payload.columnName);
    };

    service.enable();
    const context = {
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [{ name: "partner", dataType: "VARCHAR" }],
    };

    service.refresh(context);
    service.refresh(context);

    await flushPromises();

    expect(bridgeMock.runColumnProfileMetricCalls.length).toBe(3);
    expect(service.completedTasks()).toBe(3);
  });

  it("keeps analysis empty until at least one column is selected", async () => {
    const service = TestBed.inject(DataAnalysisPluginService);

    service.enable();
    service.refresh({
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [],
    });

    await flushPromises();

    expect(service.running()).toBe(false);
    expect(service.columnProfiles()).toEqual([]);
    expect(service.totalTasks()).toBe(0);
    expect(bridgeMock.runColumnProfileMetricCalls.length).toBe(0);
  });

  it("computes metrics only for newly dropped columns", async () => {
    const service = TestBed.inject(DataAnalysisPluginService);

    bridgeMock.runColumnProfileMetricImpl = async (payload) => {
      if (payload.metric === "completenessAudit") {
        return completenessResult(payload.columnName, 0.9);
      }
      if (payload.metric === "cardinalityTopValues") {
        return cardinalityResult(payload.columnName);
      }
      return lengthResult(payload.columnName);
    };

    service.enable();
    service.refresh({
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [{ name: "partner", dataType: "VARCHAR" }],
    });

    await flushPromises();

    expect(bridgeMock.runColumnProfileMetricCalls.length).toBe(3);

    service.refresh({
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [
        { name: "partner", dataType: "VARCHAR" },
        { name: "iban", dataType: "VARCHAR" },
      ],
    });

    await flushPromises();

    expect(bridgeMock.runColumnProfileMetricCalls.length).toBe(6);
    expect(bridgeMock.runColumnProfileMetricCalls.slice(3).every((call) => call.columnName === "iban")).toBe(true);
  });

  it("does not recompute remaining columns when a chart is removed", async () => {
    const service = TestBed.inject(DataAnalysisPluginService);

    bridgeMock.runColumnProfileMetricImpl = async (payload) => {
      if (payload.metric === "completenessAudit") {
        return completenessResult(payload.columnName, 0.9);
      }
      if (payload.metric === "cardinalityTopValues") {
        return cardinalityResult(payload.columnName);
      }
      return lengthResult(payload.columnName);
    };

    service.enable();
    service.refresh({
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [
        { name: "partner", dataType: "VARCHAR" },
        { name: "iban", dataType: "VARCHAR" },
      ],
    });

    await flushPromises();
    expect(bridgeMock.runColumnProfileMetricCalls.length).toBe(6);

    service.refresh({
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [{ name: "partner", dataType: "VARCHAR" }],
    });

    await flushPromises();

    expect(bridgeMock.runColumnProfileMetricCalls.length).toBe(6);
    expect(service.columnProfiles().length).toBe(1);
    expect(service.columnProfiles()[0]?.columnName).toBe("partner");
    expect(service.columnProfiles()[0]?.completeness.status).toBe("ready");
  });

  it("suspends active work and ignores late metric results until the next refresh", async () => {
    const service = TestBed.inject(DataAnalysisPluginService);
    const deferred = createDeferred<ColumnProfileMetricResult>();

    bridgeMock.runColumnProfileMetricImpl = async () => await deferred.promise;

    service.enable();
    service.refresh({
      tableName: "transactions",
      sql: "SELECT * FROM transactions",
      columns: [{ name: "partner", dataType: "VARCHAR" }],
    });

    expect(service.running()).toBe(true);
    expect(service.columnProfiles()[0]?.completeness.status).toBe("loading");
    expect(bridgeMock.runColumnProfileMetricCalls.length).toBeGreaterThan(0);

    service.suspend();

    expect(service.running()).toBe(false);
    expect(service.columnProfiles()).toEqual([]);
    expect(service.totalTasks()).toBe(0);
    expect(service.completedTasks()).toBe(0);

    deferred.resolve(completenessResult("partner", 1));
    await flushPromises();

    expect(service.columnProfiles()).toEqual([]);
    expect(service.completedTasks()).toBe(0);
  });
});

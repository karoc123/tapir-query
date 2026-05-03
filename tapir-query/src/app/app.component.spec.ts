import { TestBed } from "@angular/core/testing";
import { AppComponent } from "./app.component";
import { IngestionHandlers, IngestionService } from "./domain/ingestion.service";
import { TauriBridgeService } from "./infrastructure/tauri-bridge.service";
import { MockTauriService } from "./testing/mock-tauri.service";

describe("AppComponent", () => {
  const bridgeMock = new MockTauriService();
  let capturedNativeHandlers: IngestionHandlers | undefined;
  const ingestionMock = {
    attachNativeDropListener: jest.fn(async (handlers?: IngestionHandlers) => {
      capturedNativeHandlers = handlers;
      return null;
    }),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        { provide: TauriBridgeService, useValue: bridgeMock },
        { provide: IngestionService, useValue: ingestionMock },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    bridgeMock.reset();
    capturedNativeHandlers = undefined;
    ingestionMock.attachNativeDropListener.mockClear();
  });

  it("loads file and executes default query", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    expect(component.isEmptyLayout()).toBe(true);
    await component.onFileDropped("/tmp/transactions.csv");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(bridgeMock.openFileCalls).toEqual(["/tmp/transactions.csv"]);
    expect(bridgeMock.startQuerySessionCalls.length).toBe(0);
    expect(bridgeMock.readQuerySessionChunkCalls.length).toBe(0);
    expect(bridgeMock.executeQueryCalls.length).toBeGreaterThanOrEqual(1);
    expect(bridgeMock.executeQueryCalls[0]).toEqual({
      sql: "SELECT * FROM transactions LIMIT 1000",
      limit: 1000,
      offset: 0,
    });
    expect(component.rows().length).toBe(1);
    expect(component.columns()).toEqual(["amount", "currency"]);
    expect(component.queryError()).toBeNull();
    expect(component.isLoadedLayout()).toBe(true);
    expect(component.rowStatusLabel()).toMatch(/Row|Rows|of/);
  });

  it("shows a red LIMIT marker in the status bar when the executed query is capped by LIMIT", async () => {
    bridgeMock.executeQueryResults.push({
      ...bridgeMock.queryResult,
      rows: Array.from({ length: 1000 }, (_, index) => ({
        amount: String(index + 1),
        currency: "EUR",
      })),
      limit: 1000,
      nextOffset: null,
    });

    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    await component.onFileDropped("/tmp/transactions.csv");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(component.statusBarRowLabel()).toBe("(1,000 LIMIT)");
    expect(component.statusBarRowLabelIsLimited()).toBe(true);
  });

  it("prevents query execution before a file is loaded", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    await component.runQuery();

    expect(bridgeMock.startQuerySessionCalls.length).toBe(0);
    expect(component.queryError()?.summary).toContain("Open a CSV file before running a query");
  });

  it("exports active query result", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    await component.onFileDropped("/tmp/transactions.csv");
    await component.exportCsv("exports/query-results.csv");

    expect(bridgeMock.exportCsvCalls[0]).toEqual({
      sql: "SELECT * FROM transactions LIMIT 1000",
      outputPath: "exports/query-results.csv",
    });
  });

  it("opens CSV files dropped through native Tauri drag-drop events", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await Promise.resolve();

    expect(capturedNativeHandlers?.onFilePath).toBeDefined();
    await capturedNativeHandlers?.onFilePath?.("/tmp/native-drop.csv");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    expect(bridgeMock.openFileCalls).toEqual(["/tmp/native-drop.csv"]);
    expect(component.queryError()).toBeNull();
  });

  it("rejects non-CSV files dropped through native Tauri drag-drop events", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    await Promise.resolve();

    expect(capturedNativeHandlers?.onFilePath).toBeDefined();
    await capturedNativeHandlers?.onFilePath?.("/tmp/native-drop.txt");

    expect(bridgeMock.openFileCalls).toEqual([]);
    expect(component.queryError()?.summary).toContain("Only CSV files are supported");
  });
});

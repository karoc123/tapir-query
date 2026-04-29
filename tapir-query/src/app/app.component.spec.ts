import { TestBed } from "@angular/core/testing";
import { AppComponent } from "./app.component";
import { TauriBridgeService } from "./infrastructure/tauri-bridge.service";
import { MockTauriService } from "./testing/mock-tauri.service";

describe("AppComponent", () => {
  const bridgeMock = new MockTauriService();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [{ provide: TauriBridgeService, useValue: bridgeMock }],
    }).compileComponents();
  });

  afterEach(() => {
    bridgeMock.reset();
  });

  it("loads file and executes default query", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    expect(component.isEmptyLayout()).toBe(true);

    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Drop CSV here");

    await component.onFileDropped("/tmp/transactions.csv");
    fixture.detectChanges();

    expect(bridgeMock.openFileCalls).toEqual(["/tmp/transactions.csv"]);
    expect(bridgeMock.executeQueryCalls.length).toBe(1);
    expect(component.rows().length).toBe(1);
    expect(component.columns()).toEqual(["amount", "currency"]);
    expect(component.queryError()).toBeNull();
    expect(component.isLoadedLayout()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain("Query took");
  });

  it("prevents query execution before a file is loaded", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    await component.runQuery();

    expect(bridgeMock.executeQueryCalls.length).toBe(0);
    expect(component.queryError()?.summary).toContain("Open a CSV file before running a query");
  });

  it("exports active query result", async () => {
    const fixture = TestBed.createComponent(AppComponent);
    const component = fixture.componentInstance;

    await component.onFileDropped("/tmp/transactions.csv");
    await component.exportCsv("exports/query-results.csv");

    expect(bridgeMock.exportCsvCalls[0]).toEqual({
      sql: "SELECT * FROM transactions",
      outputPath: "exports/query-results.csv",
    });
  });
});

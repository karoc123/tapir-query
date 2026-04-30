import { TestBed } from "@angular/core/testing";
import { FileService } from "../domain/file.service";
import { LayoutStateService } from "./layout-state.service";

describe("LayoutStateService", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it("starts in empty mode and moves to loaded mode after file open", () => {
    const fileService = TestBed.inject(FileService);
    const service = TestBed.inject(LayoutStateService);

    expect(service.mode()).toBe("empty");
    expect(service.schemaCollapsed()).toBe(true);
    expect(service.analysisPanelOpen()).toBe(false);

    fileService.setOpenedFile({
      tableName: "transactions",
      filePath: "/tmp/transactions.csv",
      columns: [{ name: "amount", dataType: "DOUBLE" }],
      defaultQuery: "SELECT * FROM transactions",
      fileSizeBytes: 2048,
    });

    expect(service.mode()).toBe("loaded");
    expect(service.schemaCollapsed()).toBe(true);
  });

  it("opens schema only while analyze panel is open", () => {
    const fileService = TestBed.inject(FileService);
    const service = TestBed.inject(LayoutStateService);

    fileService.setOpenedFile({
      tableName: "transactions",
      filePath: "/tmp/transactions.csv",
      columns: [{ name: "amount", dataType: "DOUBLE" }],
      defaultQuery: "SELECT * FROM transactions",
      fileSizeBytes: 2048,
    });

    expect(service.schemaCollapsed()).toBe(true);

    service.openAnalysisPanel();
    expect(service.analysisPanelOpen()).toBe(true);
    expect(service.schemaCollapsed()).toBe(false);

    service.closeAnalysisPanel();
    expect(service.analysisPanelOpen()).toBe(false);
    expect(service.schemaCollapsed()).toBe(true);
  });

  it("resets panel states when returning to empty mode", () => {
    const fileService = TestBed.inject(FileService);
    const service = TestBed.inject(LayoutStateService);

    fileService.setOpenedFile({
      tableName: "transactions",
      filePath: "/tmp/transactions.csv",
      columns: [{ name: "amount", dataType: "DOUBLE" }],
      defaultQuery: "SELECT * FROM transactions",
      fileSizeBytes: 2048,
    });

    service.openCheatSheet();
    service.openAnalysisPanel();

    expect(service.schemaCollapsed()).toBe(false);
    expect(service.cheatSheetOpen()).toBe(true);
    expect(service.analysisPanelOpen()).toBe(true);

    fileService.clear();
    TestBed.flushEffects();

    expect(service.mode()).toBe("empty");
    expect(service.schemaCollapsed()).toBe(true);
    expect(service.cheatSheetOpen()).toBe(false);
    expect(service.analysisPanelOpen()).toBe(false);
  });
});

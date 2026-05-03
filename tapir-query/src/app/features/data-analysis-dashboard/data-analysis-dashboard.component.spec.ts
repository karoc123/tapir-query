import { TestBed } from "@angular/core/testing";
import { DataAnalysisDashboardComponent } from "./data-analysis-dashboard.component";

describe("DataAnalysisDashboardComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataAnalysisDashboardComponent],
    }).compileComponents();
  });

  it("emits dropped columns from schema payloads", () => {
    const fixture = TestBed.createComponent(DataAnalysisDashboardComponent);
    const component = fixture.componentInstance;
    const emitted: Array<{ columnName: string; dataType: string | null }> = [];

    fixture.componentRef.setInput("columns", []);
    component.columnDropped.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    component.onDropZoneDrop({ name: "amount", dataType: "DOUBLE" });

    expect(emitted).toEqual([
      {
        columnName: "amount",
        dataType: "DOUBLE",
      },
    ]);
  });

  it("activates and deactivates the drop zone for column payloads", () => {
    const fixture = TestBed.createComponent(DataAnalysisDashboardComponent);
    const component = fixture.componentInstance;

    fixture.componentRef.setInput("columns", []);
    fixture.detectChanges();

    component.onDropZoneDragEnter({ name: "country", dataType: "VARCHAR" });

    expect(component.dropActive()).toBe(true);

    component.onDropZoneDragLeave({ name: "country", dataType: "VARCHAR" });

    expect(component.dropActive()).toBe(false);
  });

  it("ignores unsupported payloads", () => {
    const fixture = TestBed.createComponent(DataAnalysisDashboardComponent);
    const component = fixture.componentInstance;
    const emitted: Array<{ columnName: string; dataType: string | null }> = [];

    fixture.componentRef.setInput("columns", []);
    component.columnDropped.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    component.onDropZoneDragEnter({ foo: "bar" });
    component.onDropZoneDrop({ foo: "bar" });

    expect(component.dropActive()).toBe(false);
    expect(emitted).toEqual([]);
  });
});

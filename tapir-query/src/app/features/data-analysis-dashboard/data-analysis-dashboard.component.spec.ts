import { TestBed } from "@angular/core/testing";
import { DataAnalysisDashboardComponent } from "./data-analysis-dashboard.component";

describe("DataAnalysisDashboardComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataAnalysisDashboardComponent],
    }).compileComponents();
  });

  it("uses text/plain as fallback for dropped column names", () => {
    const fixture = TestBed.createComponent(DataAnalysisDashboardComponent);
    const component = fixture.componentInstance;
    const emitted: Array<{ columnName: string; dataType: string | null }> = [];

    fixture.componentRef.setInput("columns", []);
    component.columnDropped.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    const transfer = {
      files: { length: 0 },
      getData: (type: string) => {
        if (type === "text/plain") {
          return "amount";
        }

        return "";
      },
    } as unknown as DataTransfer;

    component.onDropZoneDrop({
      preventDefault: () => undefined,
      dataTransfer: transfer,
    } as unknown as DragEvent);

    expect(emitted).toEqual([
      {
        columnName: "amount",
        dataType: null,
      },
    ]);
  });

  it("keeps the drop zone active across nested drag transitions without relatedTarget", () => {
    const fixture = TestBed.createComponent(DataAnalysisDashboardComponent);
    const component = fixture.componentInstance;

    fixture.componentRef.setInput("columns", []);
    fixture.detectChanges();

    const container = document.createElement("div");
    const transfer = {
      files: { length: 0 },
      types: ["Text"],
      getData: () => "",
    } as unknown as DataTransfer;

    component.onDropZoneDragEnter({
      preventDefault: () => undefined,
      dataTransfer: transfer,
    } as unknown as DragEvent);
    component.onDropZoneDragEnter({
      preventDefault: () => undefined,
      dataTransfer: transfer,
    } as unknown as DragEvent);
    component.onDropZoneDragLeave({
      currentTarget: container,
      relatedTarget: null,
    } as unknown as DragEvent);

    expect(component.dropActive()).toBe(true);

    component.onDropZoneDragLeave({
      currentTarget: container,
      relatedTarget: null,
    } as unknown as DragEvent);

    expect(component.dropActive()).toBe(false);
  });

  it("uses legacy Text payload as a Windows fallback", () => {
    const fixture = TestBed.createComponent(DataAnalysisDashboardComponent);
    const component = fixture.componentInstance;
    const emitted: Array<{ columnName: string; dataType: string | null }> = [];

    fixture.componentRef.setInput("columns", []);
    component.columnDropped.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    const transfer = {
      files: { length: 0 },
      getData: (type: string) => {
        if (type === "Text") {
          return "country";
        }

        return "";
      },
    } as unknown as DataTransfer;

    component.onDropZoneDrop({
      preventDefault: () => undefined,
      dataTransfer: transfer,
    } as unknown as DragEvent);

    expect(emitted).toEqual([
      {
        columnName: "country",
        dataType: null,
      },
    ]);
  });
});

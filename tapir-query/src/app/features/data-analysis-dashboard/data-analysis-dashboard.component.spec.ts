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
});

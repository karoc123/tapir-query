import { TestBed } from "@angular/core/testing";
import { DataTableComponent } from "./data-table.component";

describe("DataTableComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DataTableComponent],
    }).compileComponents();
  });

  it("emits ascending sort request for a new column", () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    const component = fixture.componentInstance;
    const emitted: Array<{ column: string; direction: "asc" | "desc" }> = [];

    fixture.componentRef.setInput("columns", ["amount", "currency"]);
    component.sortRequested.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    component.toggleSort("amount");

    expect(emitted).toEqual([{ column: "amount", direction: "asc" }]);
  });

  it("emits descending sort request when toggling current ascending column", () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    const component = fixture.componentInstance;
    const emitted: Array<{ column: string; direction: "asc" | "desc" }> = [];

    fixture.componentRef.setInput("columns", ["amount"]);
    fixture.componentRef.setInput("sortColumn", "amount");
    fixture.componentRef.setInput("sortDirection", "asc");
    component.sortRequested.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    component.toggleSort("amount");

    expect(emitted).toEqual([{ column: "amount", direction: "desc" }]);
  });

  it("emits explicit ascending sort request", () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    const component = fixture.componentInstance;
    const emitted: Array<{ column: string; direction: "asc" | "desc" }> = [];

    fixture.componentRef.setInput("columns", ["amount"]);
    component.sortRequested.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    component.requestSort("amount", "asc");

    expect(emitted).toEqual([{ column: "amount", direction: "asc" }]);
  });

  it("emits filter request for the selected column", () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    const component = fixture.componentInstance;
    const emitted: string[] = [];

    fixture.componentRef.setInput("columns", ["currency"]);
    component.filterRequested.subscribe((column) => emitted.push(column));
    fixture.detectChanges();

    component.requestFilter("currency");

    expect(emitted).toEqual(["currency"]);
  });
});

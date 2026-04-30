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
    const emitted: Array<{ columnName: string; operator: string; value: string }> = [];

    fixture.componentRef.setInput("columns", ["currency"]);
    component.filterRequested.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    const operatorSelect = document.createElement("select");
    const containsOption = document.createElement("option");
    containsOption.value = "contains";
    containsOption.text = "Contains";
    operatorSelect.appendChild(containsOption);
    operatorSelect.value = "contains";

    const valueInput = document.createElement("input");
    valueInput.value = " chf ";

    component.toggleFilterEditor("currency");
    component.onFilterOperatorChanged({
      target: operatorSelect,
    } as unknown as Event);
    component.onFilterValueInput({
      target: valueInput,
    } as unknown as Event);
    component.applyActiveFilter();

    expect(emitted).toEqual([
      {
        columnName: "currency",
        operator: "contains",
        value: "chf",
      },
    ]);
  });

  it("does not emit filter request when value is empty", () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    const component = fixture.componentInstance;
    const emitted: Array<{ columnName: string; operator: string; value: string }> = [];

    fixture.componentRef.setInput("columns", ["currency"]);
    component.filterRequested.subscribe((payload) => emitted.push(payload));
    fixture.detectChanges();

    const valueInput = document.createElement("input");
    valueInput.value = "   ";

    component.toggleFilterEditor("currency");
    component.onFilterValueInput({
      target: valueInput,
    } as unknown as Event);
    component.applyActiveFilter();

    expect(emitted).toEqual([]);
  });

  it("anchors the first column filter popover to the start edge", () => {
    const fixture = TestBed.createComponent(DataTableComponent);
    const component = fixture.componentInstance;

    fixture.componentRef.setInput("columns", ["amount", "currency"]);
    fixture.detectChanges();

    component.toggleFilterEditor("amount");
    fixture.detectChanges();

    const popover = fixture.nativeElement.querySelector(".filter-popover") as HTMLElement | null;

    expect(popover).not.toBeNull();
    expect(popover?.classList.contains("align-start")).toBe(true);
  });
});

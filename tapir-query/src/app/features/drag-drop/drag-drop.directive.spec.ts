import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { DragDropDirective } from "./drag-drop.directive";

@Component({
  imports: [DragDropDirective],
  template: `<div tapirDragDrop (fileDropped)="dropped = $event" (dropError)="error = $event"></div>`,
})
class HostComponent {
  dropped: string | null = null;
  error: string | null = null;
}

describe("DragDropDirective", () => {
  let fixture: ComponentFixture<HostComponent>;
  let zone: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    zone = fixture.nativeElement.querySelector("[tapirDragDrop]");
  });

  it("toggles the drag-active class on dragover/dragleave", () => {
    zone.dispatchEvent(new Event("dragover", { cancelable: true }));
    fixture.detectChanges();
    expect(zone.classList.contains("drag-active")).toBe(true);

    zone.dispatchEvent(new Event("dragleave", { cancelable: true }));
    fixture.detectChanges();
    expect(zone.classList.contains("drag-active")).toBe(false);
  });
});

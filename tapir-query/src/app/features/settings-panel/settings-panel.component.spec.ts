import { TestBed } from "@angular/core/testing";
import { SettingsPanelComponent } from "./settings-panel.component";

describe("SettingsPanelComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsPanelComponent],
    }).compileComponents();
  });

  it("renders the app version in the settings panel", () => {
    const fixture = TestBed.createComponent(SettingsPanelComponent);

    fixture.componentRef.setInput("open", true);
    fixture.componentRef.setInput("version", "1.2.3");
    fixture.componentRef.setInput("options", []);
    fixture.detectChanges();

    const textContent = fixture.nativeElement.textContent ?? "";

    expect(textContent).toContain("Version");
    expect(textContent).toContain("1.2.3");
  });
});

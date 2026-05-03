import { CommonModule } from "@angular/common";
import { Component, input, output } from "@angular/core";
import { AppTheme, ThemeOption } from "../../infrastructure/theme.service";

@Component({
  selector: "app-settings-panel",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./settings-panel.component.html",
  styleUrl: "./settings-panel.component.css",
})
export class SettingsPanelComponent {
  readonly open = input(false);
  readonly activeTheme = input<AppTheme>("light");
  readonly options = input<ThemeOption[]>([]);
  readonly version = input<string | null>(null);
  readonly runtimeLogPath = input<string | null>(null);

  readonly closeRequested = output<void>();
  readonly themeSelected = output<AppTheme>();

  close(): void {
    this.closeRequested.emit();
  }

  selectTheme(theme: AppTheme): void {
    this.themeSelected.emit(theme);
  }
}

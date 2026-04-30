import { computed, effect, inject, Injectable, signal } from "@angular/core";
import { FileService } from "../domain/file.service";

export type LayoutMode = "empty" | "loaded";

@Injectable({
  providedIn: "root",
})
export class LayoutStateService {
  private readonly fileService = inject(FileService);

  private readonly cheatSheetOpenState = signal(false);
  private readonly analysisPanelOpenState = signal(false);

  readonly mode = computed<LayoutMode>(() => (this.fileService.currentTable() ? "loaded" : "empty"));
  readonly isEmpty = computed(() => this.mode() === "empty");
  readonly isLoaded = computed(() => this.mode() === "loaded");
  readonly schemaCollapsed = computed(() => !this.isLoaded() || !this.analysisPanelOpenState());
  readonly cheatSheetOpen = computed(() => this.cheatSheetOpenState());
  readonly analysisPanelOpen = computed(() => this.analysisPanelOpenState());

  constructor() {
    effect(() => {
      if (!this.isLoaded()) {
        this.cheatSheetOpenState.set(false);
        this.analysisPanelOpenState.set(false);
      }
    });
  }

  toggleCheatSheet(): void {
    if (!this.isLoaded()) {
      return;
    }

    this.cheatSheetOpenState.update((open) => !open);
  }

  openCheatSheet(): void {
    if (!this.isLoaded()) {
      return;
    }

    this.cheatSheetOpenState.set(true);
  }

  closeCheatSheet(): void {
    this.cheatSheetOpenState.set(false);
  }

  toggleAnalysisPanel(): void {
    if (!this.isLoaded()) {
      return;
    }

    this.analysisPanelOpenState.update((open) => !open);
  }

  openAnalysisPanel(): void {
    if (!this.isLoaded()) {
      return;
    }

    this.analysisPanelOpenState.set(true);
  }

  closeAnalysisPanel(): void {
    this.analysisPanelOpenState.set(false);
  }
}

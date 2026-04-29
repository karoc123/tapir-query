import { computed, effect, inject, Injectable, signal } from "@angular/core";
import { FileService } from "../domain/file.service";

export type LayoutMode = "empty" | "loaded";

@Injectable({
  providedIn: "root",
})
export class LayoutStateService {
  private readonly fileService = inject(FileService);

  private readonly schemaCollapsedState = signal(true);
  private readonly cheatSheetOpenState = signal(false);

  readonly mode = computed<LayoutMode>(() =>
    this.fileService.currentTable() ? "loaded" : "empty",
  );
  readonly isEmpty = computed(() => this.mode() === "empty");
  readonly isLoaded = computed(() => this.mode() === "loaded");
  readonly schemaCollapsed = computed(() => this.schemaCollapsedState());
  readonly cheatSheetOpen = computed(() => this.cheatSheetOpenState());

  constructor() {
    effect(() => {
      if (!this.isLoaded()) {
        this.schemaCollapsedState.set(true);
        this.cheatSheetOpenState.set(false);
      }
    });
  }

  toggleSchemaSidebar(): void {
    if (!this.isLoaded()) {
      return;
    }

    this.schemaCollapsedState.update((value) => !value);
  }

  collapseSchemaSidebar(): void {
    this.schemaCollapsedState.set(true);
  }

  expandSchemaSidebar(): void {
    if (!this.isLoaded()) {
      return;
    }

    this.schemaCollapsedState.set(false);
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
}

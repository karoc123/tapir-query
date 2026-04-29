import { DOCUMENT } from "@angular/common";
import { computed, inject, Injectable, signal } from "@angular/core";

export type AppTheme = "soft-tapir" | "dark-banking";

export interface ThemeOption {
  id: AppTheme;
  label: string;
  description: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "soft-tapir",
    label: "Soft Tapir",
    description: "Soft slate grays with muted white and anthracite accents.",
  },
  {
    id: "dark-banking",
    label: "Dark Banking",
    description: "High-contrast dark profile suited for low-light operations.",
  },
];

@Injectable({
  providedIn: "root",
})
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly storageKey = "tapir.theme.v1";

  private readonly themeState = signal<AppTheme>("soft-tapir");
  private readonly settingsOpenState = signal(false);

  readonly theme = computed(() => this.themeState());
  readonly settingsOpen = computed(() => this.settingsOpenState());
  readonly options = computed(() => THEME_OPTIONS);

  constructor() {
    this.applyTheme(this.loadTheme());
  }

  setTheme(theme: AppTheme): void {
    this.applyTheme(theme);
  }

  toggleSettings(): void {
    this.settingsOpenState.update((open) => !open);
  }

  openSettings(): void {
    this.settingsOpenState.set(true);
  }

  closeSettings(): void {
    this.settingsOpenState.set(false);
  }

  private applyTheme(theme: AppTheme): void {
    this.themeState.set(theme);

    const root = this.document?.documentElement;
    if (root) {
      root.setAttribute("data-theme", theme);
    }

    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(this.storageKey, theme);
      } catch {
        // Ignore storage limitations.
      }
    }
  }

  private loadTheme(): AppTheme {
    if (typeof localStorage === "undefined") {
      return "soft-tapir";
    }

    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved === "soft-tapir" || saved === "dark-banking") {
        return saved;
      }
    } catch {
      // Ignore storage read issues.
    }

    return "soft-tapir";
  }
}

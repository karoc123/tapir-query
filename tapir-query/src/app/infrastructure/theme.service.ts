import { DOCUMENT } from "@angular/common";
import { computed, inject, Injectable, signal } from "@angular/core";

export type AppTheme = "light" | "dark" | "dark-2026" | "night-owl";

export interface ThemeOption {
  id: AppTheme;
  label: string;
  description: string;
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "light",
    label: "Light",
    description: "Bright workspace with calm neutral surfaces.",
  },
  {
    id: "dark",
    label: "Dark",
    description: "VS Code Dark aligned surfaces and accent colors.",
  },
  {
    id: "dark-2026",
    label: "Dark 2026",
    description: "Official VS Code Dark 2026 defaults from vscode.theme-defaults.",
  },
  {
    id: "night-owl",
    label: "Night Owl",
    description: "Night Owl inspired palette with deep blue surfaces and violet accents.",
  },
];

@Injectable({
  providedIn: "root",
})
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly storageKey = "tapir.theme.v1";

  private readonly themeState = signal<AppTheme>("light");
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
      return "light";
    }

    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved === "light" || saved === "dark" || saved === "dark-2026" || saved === "night-owl") {
        return saved;
      }

      if (saved === "soft-tapir") {
        return "light";
      }

      if (saved === "dark-banking") {
        return "dark";
      }
    } catch {
      // Ignore storage read issues.
    }

    return "light";
  }
}

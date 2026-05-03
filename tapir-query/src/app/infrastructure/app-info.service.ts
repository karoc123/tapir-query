import { computed, inject, Injectable, signal } from "@angular/core";
import { TauriBridgeService } from "./tauri-bridge.service";

@Injectable({
  providedIn: "root",
})
export class AppInfoService {
  private readonly bridge = inject(TauriBridgeService);
  private readonly runtimeLoggingStorageKey = "tapir.runtime-logging.v1";

  private readonly versionState = signal("loading...");
  private readonly runtimeLogPathState = signal("loading...");
  private readonly runtimeLoggingEnabledState = signal(false);

  readonly version = computed(() => this.versionState());
  readonly runtimeLogPath = computed(() => this.runtimeLogPathState());
  readonly runtimeLoggingEnabled = computed(() => this.runtimeLoggingEnabledState());

  constructor() {
    void this.loadVersion();
    void this.loadRuntimeDiagnostics();
  }

  private async loadVersion(): Promise<void> {
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      const version = (await getVersion()).trim();
      this.versionState.set(version || "unknown");
    } catch {
      this.versionState.set("dev");
    }
  }

  async setRuntimeLoggingEnabled(enabled: boolean): Promise<void> {
    const previousEnabled = this.runtimeLoggingEnabledState();
    this.runtimeLoggingEnabledState.set(enabled);
    this.persistRuntimeLoggingPreference(enabled);

    try {
      const state = await this.bridge.setRuntimeLoggingEnabled({ enabled });
      this.runtimeLogPathState.set(state.logPath);
      this.runtimeLoggingEnabledState.set(state.enabled);
      this.persistRuntimeLoggingPreference(state.enabled);
    } catch (error) {
      this.runtimeLoggingEnabledState.set(previousEnabled);
      this.persistRuntimeLoggingPreference(previousEnabled);
      throw error;
    }
  }

  private async loadRuntimeDiagnostics(): Promise<void> {
    const preferredEnabled = this.loadRuntimeLoggingPreference();
    this.runtimeLoggingEnabledState.set(preferredEnabled);

    try {
      const state = await this.bridge.getRuntimeLoggingStatus();
      this.runtimeLogPathState.set(state.logPath);

      if (state.enabled !== preferredEnabled) {
        const updatedState = await this.bridge.setRuntimeLoggingEnabled({ enabled: preferredEnabled });
        this.runtimeLogPathState.set(updatedState.logPath);
        this.runtimeLoggingEnabledState.set(updatedState.enabled);
        this.persistRuntimeLoggingPreference(updatedState.enabled);
        return;
      }

      this.runtimeLoggingEnabledState.set(state.enabled);
    } catch {
      this.runtimeLogPathState.set("dev console only");
      this.runtimeLoggingEnabledState.set(false);
      this.persistRuntimeLoggingPreference(false);
    }
  }

  private loadRuntimeLoggingPreference(): boolean {
    if (typeof localStorage === "undefined") {
      return false;
    }

    try {
      return localStorage.getItem(this.runtimeLoggingStorageKey) === "1";
    } catch {
      return false;
    }
  }

  private persistRuntimeLoggingPreference(enabled: boolean): void {
    if (typeof localStorage === "undefined") {
      return;
    }

    try {
      localStorage.setItem(this.runtimeLoggingStorageKey, enabled ? "1" : "0");
    } catch {
      // Ignore storage limitations.
    }
  }
}

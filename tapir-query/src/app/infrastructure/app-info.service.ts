import { computed, Injectable, signal } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class AppInfoService {
  private readonly versionState = signal("loading...");
  private readonly runtimeLogPathState = signal("loading...");

  readonly version = computed(() => this.versionState());
  readonly runtimeLogPath = computed(() => this.runtimeLogPathState());

  constructor() {
    void this.loadVersion();
    void this.loadRuntimeLogPath();
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

  private async loadRuntimeLogPath(): Promise<void> {
    try {
      const { appLogDir, join } = await import("@tauri-apps/api/path");
      const logDirectory = await appLogDir();
      const logPath = await join(logDirectory, "tapir-query.log");
      this.runtimeLogPathState.set(logPath);
    } catch {
      this.runtimeLogPathState.set("dev console only");
    }
  }
}

import { computed, Injectable, signal } from "@angular/core";

@Injectable({
  providedIn: "root",
})
export class AppInfoService {
  private readonly versionState = signal("loading...");

  readonly version = computed(() => this.versionState());

  constructor() {
    void this.loadVersion();
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
}

import { inject, Injectable, InjectionToken } from "@angular/core";
import { LogService } from "../infrastructure/log.service";

interface NativeWebviewWindow {
  onDragDropEvent(callback: (event: unknown) => void): Promise<() => void>;
}

interface NativeWebviewWindowModule {
  getCurrentWebviewWindow(): NativeWebviewWindow;
}

type NativeWebviewWindowLoader = () => Promise<NativeWebviewWindowModule>;

interface ParsedDropEvent {
  type: string | null;
  paths: unknown[];
}

export interface IngestionHandlers {
  onFilePath?: (filePath: string) => void | Promise<void>;
}

export const NATIVE_WEBVIEW_WINDOW_LOADER = new InjectionToken<NativeWebviewWindowLoader>("NATIVE_WEBVIEW_WINDOW_LOADER", {
  providedIn: "root",
  factory: () => async () => {
    const module = await import("@tauri-apps/api/webviewWindow");
    return module as unknown as NativeWebviewWindowModule;
  },
});

@Injectable({
  providedIn: "root",
})
export class IngestionService {
  private readonly logs = inject(LogService);
  private readonly loadNativeWebviewWindow = inject(NATIVE_WEBVIEW_WINDOW_LOADER);

  async attachNativeDropListener(handlers?: IngestionHandlers): Promise<(() => void) | null> {
    if (!this.isTauriRuntime()) {
      this.logs.warn("drag-drop.raw", "Tauri runtime not detected; native drag-drop listener was not attached.");
      return null;
    }

    try {
      const { getCurrentWebviewWindow } = await this.loadNativeWebviewWindow();
      const webview = getCurrentWebviewWindow();

      const unlisten = await webview.onDragDropEvent((event) => {
        this.logs.info("drag-drop.raw", "Native drag-drop event", event);

        const filePath = this.extractDroppedFilePath(event);
        if (!filePath || !handlers?.onFilePath) {
          return;
        }

        void Promise.resolve(handlers.onFilePath(filePath)).catch((error: unknown) => {
          this.logs.error("drag-drop.raw", "Native file ingestion failed", {
            filePath,
            error: this.extractError(error),
          });
        });
      });

      this.logs.info("drag-drop.raw", "Attached native drag-drop listener");
      return unlisten;
    } catch (error) {
      this.logs.error("drag-drop.raw", "Failed to attach native drag-drop listener", {
        error: this.extractError(error),
      });
      return null;
    }
  }

  private extractDroppedFilePath(event: unknown): string | null {
    const parsed = this.parseDropEvent(event);
    if (!parsed || parsed.type !== "drop") {
      return null;
    }

    for (const candidate of parsed.paths) {
      if (typeof candidate !== "string") {
        continue;
      }

      const trimmed = candidate.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    return null;
  }

  private parseDropEvent(event: unknown): ParsedDropEvent | null {
    if (!this.isRecord(event)) {
      return null;
    }

    const payload = this.isRecord(event["payload"]) ? event["payload"] : event;
    const type = typeof payload["type"] === "string" ? payload["type"].toLowerCase() : null;
    const paths = Array.isArray(payload["paths"]) ? payload["paths"] : [];

    return {
      type,
      paths,
    };
  }

  private isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
      return false;
    }

    return "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private extractError(error: unknown): string {
    if (typeof error === "string") {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Unknown runtime error";
  }
}

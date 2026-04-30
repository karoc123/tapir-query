import { TestBed } from "@angular/core/testing";
import { LogService } from "../infrastructure/log.service";
import { IngestionService, NATIVE_WEBVIEW_WINDOW_LOADER } from "./ingestion.service";

type NativeDropHandler = (event: unknown) => void;

describe("IngestionService", () => {
  const tauriMarker = "__TAURI_INTERNALS__";

  const logs = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  let dropHandler: NativeDropHandler | null = null;
  let unlisten: jest.Mock;
  let onDragDropEvent: jest.Mock;
  let loader: jest.Mock;

  beforeEach(() => {
    dropHandler = null;
    unlisten = jest.fn();
    onDragDropEvent = jest.fn(async (handler: NativeDropHandler) => {
      dropHandler = handler;
      return unlisten;
    });
    loader = jest.fn(async () => ({
      getCurrentWebviewWindow: () => ({
        onDragDropEvent,
      }),
    }));

    logs.info.mockReset();
    logs.warn.mockReset();
    logs.error.mockReset();

    delete (window as unknown as Record<string, unknown>)[tauriMarker];

    TestBed.configureTestingModule({
      providers: [
        { provide: LogService, useValue: logs },
        { provide: NATIVE_WEBVIEW_WINDOW_LOADER, useValue: loader },
      ],
    });
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[tauriMarker];
  });

  it("skips native listener attachment outside Tauri runtime", async () => {
    const service = TestBed.inject(IngestionService);

    const unlistenFn = await service.attachNativeDropListener();

    expect(unlistenFn).toBeNull();
    expect(loader).not.toHaveBeenCalled();
    expect(logs.warn).toHaveBeenCalledWith("drag-drop.raw", "Tauri runtime not detected; native drag-drop listener was not attached.");
  });

  it("attaches listener and forwards dropped file paths from native events", async () => {
    (window as unknown as Record<string, unknown>)[tauriMarker] = {};
    const service = TestBed.inject(IngestionService);
    const onFilePath = jest.fn().mockResolvedValue(undefined);

    const unlistenFn = await service.attachNativeDropListener({ onFilePath });

    expect(unlistenFn).toBe(unlisten);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(onDragDropEvent).toHaveBeenCalledTimes(1);
    expect(dropHandler).not.toBeNull();

    const event = {
      type: "drop",
      paths: ["  /tmp/transactions.csv  "],
    };
    dropHandler?.(event);
    await Promise.resolve();

    expect(logs.info).toHaveBeenCalledWith("drag-drop.raw", "Native drag-drop event", event);
    expect(onFilePath).toHaveBeenCalledWith("/tmp/transactions.csv");
  });

  it("supports payload-wrapped events and logs ingestion callback failures", async () => {
    (window as unknown as Record<string, unknown>)[tauriMarker] = {};
    const service = TestBed.inject(IngestionService);
    const onFilePath = jest.fn(async () => {
      throw new Error("ingest boom");
    });

    await service.attachNativeDropListener({ onFilePath });

    dropHandler?.({
      payload: {
        type: "drop",
        paths: ["/tmp/broken.csv"],
      },
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(onFilePath).toHaveBeenCalledWith("/tmp/broken.csv");
    expect(logs.error).toHaveBeenCalledWith(
      "drag-drop.raw",
      "Native file ingestion failed",
      expect.objectContaining({
        filePath: "/tmp/broken.csv",
        error: "ingest boom",
      }),
    );
  });
});

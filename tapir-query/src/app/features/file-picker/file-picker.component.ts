import { CommonModule } from "@angular/common";
import { Component, input, output, signal } from "@angular/core";
import { LogService } from "../../infrastructure/log.service";

@Component({
  selector: "app-file-picker",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./file-picker.component.html",
  styleUrl: "./file-picker.component.css",
})
export class FilePickerComponent {
  readonly disabled = input(false);

  readonly fileSelected = output<string>();
  readonly pickerError = output<string>();

  readonly opening = signal(false);

  constructor(private readonly logs: LogService) {}

  async selectCsvFile(): Promise<void> {
    if (this.disabled() || this.opening()) {
      return;
    }

    this.opening.set(true);
    this.logs.info("file-picker", "Opening native file picker");

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");

      const selection = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: "CSV",
            extensions: ["csv"],
          },
        ],
      });

      if (!selection) {
        this.logs.warn("file-picker", "File picker dismissed without selection");
        return;
      }

      const path = Array.isArray(selection) ? selection[0] : selection;
      if (!path || !/\.csv$/i.test(path)) {
        const message = "The selected file is not a CSV. Please pick a .csv file.";
        this.logs.warn("file-picker", message, { path });
        this.pickerError.emit(message);
        return;
      }

      this.logs.info("file-picker", "CSV file selected via picker", { path });
      this.fileSelected.emit(path);
    } catch (error) {
      const message =
        "Unable to open native file picker. Verify Tauri dialog permissions and desktop runtime context.";
      this.logs.error("file-picker", message, {
        error: this.extractError(error),
      });
      this.pickerError.emit(message);
    } finally {
      this.opening.set(false);
    }
  }

  private extractError(error: unknown): string {
    if (typeof error === "string") {
      return error;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Unknown picker error";
  }
}

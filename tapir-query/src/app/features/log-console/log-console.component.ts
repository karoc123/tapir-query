import { CommonModule } from "@angular/common";
import { Component, input, output } from "@angular/core";
import { LogEntry } from "../../infrastructure/log.service";

@Component({
  selector: "app-log-console",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./log-console.component.html",
  styleUrl: "./log-console.component.css",
})
export class LogConsoleComponent {
  readonly entries = input<LogEntry[]>([]);
  readonly open = input(false);

  readonly closeRequested = output<void>();
  readonly clearRequested = output<void>();

  close(): void {
    this.closeRequested.emit();
  }

  clear(): void {
    this.clearRequested.emit();
  }

  formatTime(timestamp: number): string {
    return `${(timestamp / 1000).toFixed(3)}s`;
  }

  stringify(value: unknown): string {
    if (value === undefined) {
      return "";
    }

    try {
      return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
}

import { CommonModule } from "@angular/common";
import { Component, computed, input } from "@angular/core";
import { ParsedQueryError } from "../../infrastructure/error-parsing.service";
import { LogEntry } from "../../infrastructure/log.service";

@Component({
  selector: "app-grid-status-overlay",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./grid-status-overlay.component.html",
  styleUrl: "./grid-status-overlay.component.css",
})
export class GridStatusOverlayComponent {
  readonly active = input<boolean>(false);
  readonly loading = input<boolean>(false);
  readonly statusMessage = input<string>("");
  readonly error = input<ParsedQueryError | null>(null);
  readonly activityEntries = input<LogEntry[]>([]);

  readonly overlayEntries = computed(() => this.activityEntries().slice(0, 4));
}

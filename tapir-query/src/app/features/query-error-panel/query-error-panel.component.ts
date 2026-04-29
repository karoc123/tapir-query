import { CommonModule } from "@angular/common";
import { Component, input } from "@angular/core";
import { ParsedQueryError } from "../../infrastructure/error-parsing.service";

@Component({
  selector: "app-query-error-panel",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./query-error-panel.component.html",
  styleUrl: "./query-error-panel.component.css",
})
export class QueryErrorPanelComponent {
  readonly error = input<ParsedQueryError | null>(null);
}

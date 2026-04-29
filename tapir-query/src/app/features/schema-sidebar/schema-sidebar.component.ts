import { CommonModule } from "@angular/common";
import { Component, input, output } from "@angular/core";
import { ColumnSchema } from "../../infrastructure/tauri-contracts";

@Component({
  selector: "app-schema-sidebar",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./schema-sidebar.component.html",
  styleUrl: "./schema-sidebar.component.css",
})
export class SchemaSidebarComponent {
  readonly tableName = input<string | null>(null);
  readonly filePath = input<string | null>(null);
  readonly columns = input<ColumnSchema[]>([]);
  readonly collapsed = input<boolean>(true);

  readonly columnSelected = output<string>();

  selectColumn(columnName: string): void {
    this.columnSelected.emit(columnName);
  }
}

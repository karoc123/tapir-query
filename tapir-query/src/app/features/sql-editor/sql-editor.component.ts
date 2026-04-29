import { CommonModule } from "@angular/common";
import {
  AfterViewInit,
  Component,
  effect,
  ElementRef,
  input,
  OnDestroy,
  output,
  ViewChild,
} from "@angular/core";

@Component({
  selector: "app-sql-editor",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./sql-editor.component.html",
  styleUrl: "./sql-editor.component.css",
})
export class SqlEditorComponent implements AfterViewInit, OnDestroy {
  readonly query = input<string>("");
  readonly loading = input<boolean>(false);
  readonly placeholder = input<string>("Write SQL and press Ctrl/Cmd + Enter");

  readonly queryChange = output<string>();
  readonly runRequested = output<void>();

  @ViewChild("sqlInput", { static: true })
  private readonly sqlInput?: ElementRef<HTMLTextAreaElement>;

  private readonly querySyncEffect = effect(() => {
    const nextQuery = this.query();
    const textarea = this.sqlInput?.nativeElement;
    if (!textarea) {
      return;
    }

    const currentQuery = textarea.value;
    if (nextQuery === currentQuery) {
      return;
    }

    textarea.value = nextQuery;
    this.resize(textarea);
  });

  ngAfterViewInit(): void {
    const textarea = this.sqlInput?.nativeElement;
    if (!textarea) {
      return;
    }

    textarea.value = this.query();
    this.resize(textarea);
  }

  ngOnDestroy(): void {
    this.querySyncEffect.destroy();
  }

  onInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.resize(textarea);
    this.queryChange.emit(textarea.value);
  }

  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      this.runRequested.emit();
    }
  }

  private resize(textarea: HTMLTextAreaElement): void {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(56, textarea.scrollHeight)}px`;
  }
}

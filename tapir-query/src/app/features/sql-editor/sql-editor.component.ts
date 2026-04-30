import { CommonModule } from "@angular/common";
import { autocompletion, completionKeymap, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { sql, SQLite } from "@codemirror/lang-sql";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as editorPlaceholder } from "@codemirror/view";
import { AfterViewInit, Component, effect, ElementRef, HostListener, input, OnDestroy, output, signal, ViewChild } from "@angular/core";
import { ColumnSchema, QueryHistoryEntry } from "../../infrastructure/tauri-contracts";

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
  readonly tableName = input<string | null>(null);
  readonly schemaColumns = input<ColumnSchema[]>([]);
  readonly historyEntries = input<QueryHistoryEntry[]>([]);

  readonly queryChange = output<string>();
  readonly historySelected = output<string>();
  readonly runRequested = output<void>();

  readonly historyMenuOpen = signal(false);
  readonly historyTooltip = "Historie (Alt+Up / Alt+Down)";
  readonly executeTooltip = "Query ausfuehren (Ctrl/Cmd + Enter)";

  private readonly relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  });

  @ViewChild("editorHost", { static: true })
  private readonly editorHost?: ElementRef<HTMLDivElement>;

  @ViewChild("historyMenu")
  private readonly historyMenu?: ElementRef<HTMLDivElement>;

  @ViewChild("historyTrigger")
  private readonly historyTrigger?: ElementRef<HTMLButtonElement>;

  private readonly sqlCompartment = new Compartment();
  private readonly editableCompartment = new Compartment();
  private readonly placeholderCompartment = new Compartment();
  private editorView: EditorView | null = null;
  private syncingExternalQuery = false;
  private historyNavigationIndex: number | null = null;
  private historyDraftQuery: string | null = null;

  private readonly querySyncEffect = effect(() => {
    const nextQuery = this.query();
    const view = this.editorView;
    if (!view) {
      return;
    }

    const currentQuery = view.state.doc.toString();
    if (nextQuery === currentQuery) {
      return;
    }

    this.syncingExternalQuery = true;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: nextQuery,
      },
    });
    this.syncingExternalQuery = false;
  });

  private readonly loadingSyncEffect = effect(() => {
    const disabled = this.loading();
    const view = this.editorView;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: this.editableCompartment.reconfigure(this.buildEditableExtension(disabled)),
    });
  });

  private readonly placeholderSyncEffect = effect(() => {
    const text = this.placeholder();
    const view = this.editorView;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: this.placeholderCompartment.reconfigure(this.buildPlaceholderExtension(text)),
    });
  });

  private readonly schemaSyncEffect = effect(() => {
    const tableName = this.tableName();
    const columns = this.schemaColumns();
    const view = this.editorView;
    if (!view) {
      return;
    }

    view.dispatch({
      effects: this.sqlCompartment.reconfigure(this.buildSqlExtension(tableName, columns)),
    });
  });

  ngAfterViewInit(): void {
    const host = this.editorHost?.nativeElement;
    if (!host) {
      return;
    }

    this.editorView = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: this.query(),
        extensions: [
          EditorView.lineWrapping,
          this.editableCompartment.of(this.buildEditableExtension(this.loading())),
          this.placeholderCompartment.of(this.buildPlaceholderExtension(this.placeholder())),
          this.sqlCompartment.of(this.buildSqlExtension(this.tableName(), this.schemaColumns())),
          autocompletion({
            activateOnTyping: true,
          }),
          keymap.of([
            {
              key: "Alt-ArrowUp",
              run: () => this.cycleHistory("up"),
            },
            {
              key: "Alt-ArrowDown",
              run: () => this.cycleHistory("down"),
            },
            {
              key: "Mod-Enter",
              run: () => {
                if (this.loading()) {
                  return true;
                }

                this.runRequested.emit();
                return true;
              },
            },
            {
              key: "Ctrl-Space",
              run: startCompletion,
            },
            {
              key: "Mod-Space",
              run: startCompletion,
            },
            ...completionKeymap,
            ...defaultKeymap,
          ]),
          EditorView.contentAttributes.of({
            "aria-label": "SQL query",
            autocapitalize: "off",
            autocorrect: "off",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || this.syncingExternalQuery) {
              return;
            }

            this.resetHistoryNavigationState();
            this.queryChange.emit(update.state.doc.toString());
          }),
        ],
      }),
    });
  }

  ngOnDestroy(): void {
    this.querySyncEffect.destroy();
    this.loadingSyncEffect.destroy();
    this.placeholderSyncEffect.destroy();
    this.schemaSyncEffect.destroy();
    this.editorView?.destroy();
    this.editorView = null;
  }

  focusEditor(): void {
    this.editorView?.focus();
  }

  @HostListener("document:pointerdown", ["$event"])
  onDocumentPointerDown(event: PointerEvent): void {
    if (!this.historyMenuOpen()) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    const menuElement = this.historyMenu?.nativeElement;
    const triggerElement = this.historyTrigger?.nativeElement;
    if (menuElement?.contains(target) || triggerElement?.contains(target)) {
      return;
    }

    this.historyMenuOpen.set(false);
  }

  @HostListener("document:keydown.escape")
  onEscapeKey(): void {
    this.historyMenuOpen.set(false);
  }

  toggleHistoryMenu(): void {
    if (this.loading()) {
      return;
    }

    this.historyMenuOpen.update((open) => !open);
  }

  requestRun(): void {
    if (this.loading()) {
      return;
    }

    this.runRequested.emit();
  }

  selectHistoryEntry(entry: QueryHistoryEntry, closeMenu: boolean = true): void {
    this.resetHistoryNavigationState();
    this.historySelected.emit(entry.sql);
    if (closeMenu) {
      this.historyMenuOpen.set(false);
    }
  }

  trackHistoryEntry(index: number, entry: QueryHistoryEntry): string {
    return `${entry.sql}::${entry.executedAtUnixMs}::${index}`;
  }

  isHistoryEntryActive(entry: QueryHistoryEntry): boolean {
    return this.normalizeQueryForComparison(entry.sql) === this.normalizeQueryForComparison(this.currentEditorQuery());
  }

  formatRelativeTime(executedAtUnixMs: number): string {
    const deltaMs = executedAtUnixMs - Date.now();
    const absMs = Math.abs(deltaMs);

    if (absMs < 60_000) {
      return this.relativeTimeFormatter.format(Math.round(deltaMs / 1_000), "second");
    }

    if (absMs < 3_600_000) {
      return this.relativeTimeFormatter.format(Math.round(deltaMs / 60_000), "minute");
    }

    if (absMs < 86_400_000) {
      return this.relativeTimeFormatter.format(Math.round(deltaMs / 3_600_000), "hour");
    }

    if (absMs < 2_592_000_000) {
      return this.relativeTimeFormatter.format(Math.round(deltaMs / 86_400_000), "day");
    }

    if (absMs < 31_536_000_000) {
      return this.relativeTimeFormatter.format(Math.round(deltaMs / 2_592_000_000), "month");
    }

    return this.relativeTimeFormatter.format(Math.round(deltaMs / 31_536_000_000), "year");
  }

  private buildEditableExtension(disabled: boolean): Extension {
    return [EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)];
  }

  private cycleHistory(direction: "up" | "down"): boolean {
    if (this.loading()) {
      return true;
    }

    const entries = this.historyEntries();
    if (entries.length === 0) {
      return true;
    }

    if (direction === "up") {
      this.cycleHistoryBackward(entries);
      return true;
    }

    this.cycleHistoryForward(entries);
    return true;
  }

  private cycleHistoryBackward(entries: QueryHistoryEntry[]): void {
    if (this.historyNavigationIndex === null) {
      const currentQuery = this.currentEditorQuery();
      const currentMatchIndex = entries.findIndex((entry) => this.normalizeQueryForComparison(entry.sql) === this.normalizeQueryForComparison(currentQuery));
      const startingIndex = currentMatchIndex >= 0 ? Math.min(currentMatchIndex + 1, entries.length - 1) : 0;

      this.historyDraftQuery = currentQuery;
      this.historyNavigationIndex = startingIndex;
      this.historySelected.emit(entries[startingIndex]!.sql);
      return;
    }

    const nextIndex = Math.min(this.historyNavigationIndex + 1, entries.length - 1);
    this.historyNavigationIndex = nextIndex;
    this.historySelected.emit(entries[nextIndex]!.sql);
  }

  private cycleHistoryForward(entries: QueryHistoryEntry[]): void {
    if (this.historyNavigationIndex === null) {
      return;
    }

    if (this.historyNavigationIndex === 0) {
      const draftQuery = this.historyDraftQuery;
      this.resetHistoryNavigationState();
      if (draftQuery !== null) {
        this.historySelected.emit(draftQuery);
      }
      return;
    }

    const nextIndex = this.historyNavigationIndex - 1;
    this.historyNavigationIndex = nextIndex;
    this.historySelected.emit(entries[nextIndex]!.sql);
  }

  private resetHistoryNavigationState(): void {
    this.historyNavigationIndex = null;
    this.historyDraftQuery = null;
  }

  private currentEditorQuery(): string {
    return this.editorView?.state.doc.toString() ?? this.query();
  }

  private normalizeQueryForComparison(query: string): string {
    return query
      .trim()
      .replace(/;+(\s*)$/, "")
      .replace(/\s+/g, " ");
  }

  private buildPlaceholderExtension(text: string): Extension {
    return editorPlaceholder(text);
  }

  private buildSqlExtension(tableName: string | null, columns: ColumnSchema[]): Extension {
    if (!tableName || columns.length === 0) {
      return sql({
        dialect: SQLite,
        upperCaseKeywords: true,
      });
    }

    return sql({
      dialect: SQLite,
      upperCaseKeywords: true,
      schema: {
        [tableName]: columns.map((column) => ({
          label: column.name,
          type: "property",
          apply: this.escapeIdentifier(column.name),
        })),
      },
      defaultTable: tableName,
    });
  }

  private escapeIdentifier(name: string): string {
    const escaped = name.replace(/"/g, '""');
    return /[^a-zA-Z0-9_]/.test(name) ? `"${escaped}"` : escaped;
  }
}

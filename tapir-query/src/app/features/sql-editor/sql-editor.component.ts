import { CommonModule } from "@angular/common";
import { autocompletion, completionKeymap, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap } from "@codemirror/commands";
import { sql, SQLite } from "@codemirror/lang-sql";
import { Compartment, EditorState, Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as editorPlaceholder } from "@codemirror/view";
import { AfterViewInit, Component, effect, ElementRef, input, OnDestroy, output, ViewChild } from "@angular/core";
import { ColumnSchema } from "../../infrastructure/tauri-contracts";

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

  readonly queryChange = output<string>();
  readonly runRequested = output<void>();

  @ViewChild("editorHost", { static: true })
  private readonly editorHost?: ElementRef<HTMLDivElement>;

  private readonly sqlCompartment = new Compartment();
  private readonly editableCompartment = new Compartment();
  private readonly placeholderCompartment = new Compartment();
  private editorView: EditorView | null = null;
  private syncingExternalQuery = false;

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

  private buildEditableExtension(disabled: boolean): Extension {
    return [EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)];
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

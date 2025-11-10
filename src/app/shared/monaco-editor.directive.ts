import {
  Directive, ElementRef, EventEmitter, Input, NgZone, OnDestroy, OnInit, Output, OnChanges, SimpleChanges
} from '@angular/core';
import * as monacoType from 'monaco-editor';

type Monaco = typeof monacoType;

@Directive({
  selector: '[monacoEditor]',
  standalone: true,
})
export class MonacoEditorDirective implements OnInit, OnDestroy, OnChanges {
  /** Current text value (two-way bound via (valueChange)) */
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  /** Language id */
  @Input() language = 'citlang';

  /** Provide diagnostics markers (we pass expanded text from parent) */
  @Input() getMarkers?: (text: string) => monacoType.editor.IMarkerData[];

  /** Provide hover content for fold tokens: id -> hover text */
  @Input() getFoldHover?: (id: number) => string | undefined;

  private monaco!: Monaco;
  private editor!: monacoType.editor.IStandaloneCodeEditor;
  private disposers: Array<() => void> = [];

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  /** Allow parent to access the editor instance (for selection ops) */
  getEditor(): monacoType.editor.IStandaloneCodeEditor | undefined {
    return this.editor;
  }

  async ngOnInit() {
    const monaco = (await import('monaco-editor')) as Monaco;
    this.monaco = monaco;

    this.registerLanguage(monaco);
    this.registerTheme(monaco);
    this.registerHover(monaco);

    this.zone.runOutsideAngular(() => {
        this.editor = monaco.editor.create(this.host.nativeElement, {
        value: this.value,
        language: this.language,
        automaticLayout: true,
        wordWrap: 'on',
        padding: { top: 20, bottom: 16 },      // more space above & below
        fontSize: 14,
        lineHeight: 24,                         // taller lines = better hover hitbox
        minimap: { enabled: false },
        matchBrackets: 'always',
        bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
        renderWhitespace: 'selection',
        scrollBeyondLastLine: false,
        theme: 'citTheme',
        hover: { enabled: true, delay: 150, sticky: true },   // <—
        });


      const d1 = this.editor.onDidChangeModelContent(() => {
        const text = this.editor.getValue();
        this.valueChange.emit(text);
        if (this.getMarkers) {
          const markers = this.getMarkers(text) || [];
          monaco.editor.setModelMarkers(this.editor.getModel()!, 'citlang-diagnostics', markers);
        }
      });
      this.disposers.push(() => d1.dispose());
    });

    // initial markers
    if (this.getMarkers) {
      const markers = this.getMarkers(this.value) || [];
      this.monaco.editor.setModelMarkers(this.editor.getModel()!, 'citlang-diagnostics', markers);
    }
  }

  /** React to parent value changes (e.g., chips insert tokens, fold/unfold) */
  ngOnChanges(changes: SimpleChanges) {
    if (changes['value'] && this.editor) {
      const next = this.value ?? '';
      const model = this.editor.getModel();
      if (model && next !== model.getValue()) {
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: next }],
          () => null
        );
        if (this.getMarkers) {
          const markers = this.getMarkers(next) || [];
          this.monaco.editor.setModelMarkers(model, 'citlang-diagnostics', markers);
        }
      }
    }
  }

  ngOnDestroy() {
    for (const f of this.disposers) try { f(); } catch {}
    if (this.editor) this.editor.dispose();
  }

  // --- Language / theme / hover ---

  private registerLanguage(monaco: Monaco) {
    if ((monaco.languages as any)._citlangRegistered) return;
    (monaco.languages as any)._citlangRegistered = true;

    monaco.languages.register({ id: 'citlang' });

    monaco.languages.setMonarchTokensProvider('citlang', {
      tokenizer: {
        root: [
          [/\\./, 'escape'],
          [/\[%s\]/, 'placeholder'],
          [/%s/, 'placeholder'],
          [/\[\*\]/, 'fold.token'],                 // <-- fold token [*1]
          [/\[/, { token: 'expr.bracket', next: '@expr' }],
          [/\{/, { token: 'lit.brace', next: '@lit' }],
          [/\+/, 'plus'],
        ],
        expr: [
          [/\\./, 'escape'],
          [/\[%s\]/, 'placeholder'],
          [/%s/, 'placeholder'],
          [/\[\*\]/, 'fold.token'],
          [/\[/, { token: 'expr.bracket', next: '@expr' }],
          [/\{/, { token: 'lit.brace', next: '@lit' }],
          [/\]/, { token: 'expr.bracket', next: '@pop' }],
          [/\+/, 'plus'],
          [/[^\]\{\}\[]+/, 'text'],
        ],
        lit: [
          [/\\./, 'escape'],
          [/\}/, { token: 'lit.brace', next: '@pop' }],
          [/[^}]+/, 'text'],
        ],
      },
      brackets: [
        { open: '[', close: ']', token: 'expr.bracket' },
        { open: '{', close: '}', token: 'lit.brace' },
      ],
    });

    monaco.languages.setLanguageConfiguration('citlang', {
      brackets: [['[', ']'], ['{', '}']],
      autoClosingPairs: [{ open: '[', close: ']' }, { open: '{', close: '}' }],
      surroundingPairs: [{ open: '[', close: ']' }, { open: '{', close: '}' }],
    });
  }

  private registerTheme(monaco: Monaco) {
    if ((monaco.editor as any)._citThemeRegistered) return;
    (monaco.editor as any)._citThemeRegistered = true;

    monaco.editor.defineTheme('citTheme', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'expr.bracket', foreground: '2563eb', fontStyle: 'bold' },  // blue
        { token: 'lit.brace', foreground: 'b45309', fontStyle: 'bold' },     // amber
        { token: 'placeholder', foreground: 'b91c1c', fontStyle: 'bold' },   // red
        { token: 'plus', foreground: '047857', fontStyle: 'bold' },          // green
        { token: 'escape', foreground: '64748b' },                           // slate
        { token: 'fold.token', foreground: 'a21caf', fontStyle: 'bold' },    // purple
      ],
      colors: {},
    });
  }

  private registerHover(monaco: typeof import('monaco-editor')) {
  monaco.languages.registerHoverProvider('citlang', {
    provideHover: (model, position) => {
      try {
        const line = model.getLineContent(position.lineNumber);

        // Find [*] on this line and the one under the cursor
        const re = /\[\*\]/g;
        let m: RegExpExecArray | null;
        let target: { start: number; end: number } | null = null;

        while ((m = re.exec(line))) {
          const startIdx = m.index;               // 0-based
          const endIdx   = startIdx + m[0].length;  // exclusive
          const col0     = position.column - 1;     // 0-based column
          if (col0 >= startIdx && col0 < endIdx) {
            target = { start: startIdx, end: endIdx };
            break;
          }
        }
        if (!target) return undefined;

        // Compute ordinal index of this [*] across the whole document,
        // using the token START offset (not the cursor offset)
        const lineStartOffset  = model.getOffsetAt({ lineNumber: position.lineNumber, column: 1 });
        const tokenStartOffset = lineStartOffset + target.start;

        const fullText = model.getValue();
        const before   = fullText.slice(0, tokenStartOffset);
        const ordinal  = (before.match(/\[\*\]/g) || []).length; // 0-based index of this token

        // Ask parent for hover content
        const content = this.getFoldHover?.(ordinal);
        if (!content) return undefined;

        const range = new monaco.Range(
          position.lineNumber, target.start + 1,
          position.lineNumber, target.end + 1
        );

        return {
          range,
          contents: [
            { value: '**Collapsed group**' },
            { value: '```cit\n' + content + '\n```' },
            { value: '_Use **Unfold all** to expand in-place._' },
          ],
        };
      } catch {
        return undefined;
      }
    },
  });
}


}
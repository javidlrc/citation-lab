import {
  Directive, ElementRef, EventEmitter, Input, NgZone, OnDestroy, OnInit, Output
} from '@angular/core';
import * as monacoType from 'monaco-editor';

type Monaco = typeof monacoType;

@Directive({
  selector: '[monacoEditor]',
  standalone: true,
})
export class MonacoEditorDirective implements OnInit, OnDestroy {
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();
  @Input() language = 'citlang';
  @Input() getMarkers?: (text: string) => monacoType.editor.IMarkerData[];

  private monaco!: Monaco;
  private editor!: monacoType.editor.IStandaloneCodeEditor;
  private disposers: Array<() => void> = [];

  constructor(private host: ElementRef<HTMLElement>, private zone: NgZone) {}

  async ngOnInit() {
    const monaco = (await import('monaco-editor')) as Monaco;
    this.monaco = monaco;

    this.registerLanguage(monaco);
    this.registerTheme(monaco);

    this.zone.runOutsideAngular(() => {
      this.editor = monaco.editor.create(this.host.nativeElement, {
        value: this.value,
        language: this.language,
        automaticLayout: true,
        wordWrap: 'on',
        padding: { top: 8, bottom: 8 },
        fontSize: 14,
        lineHeight: 21,
        minimap: { enabled: false },
        matchBrackets: 'always',
        bracketPairColorization: { enabled: true, independentColorPoolPerBracketType: true },
        renderWhitespace: 'selection',
        scrollBeyondLastLine: false,
        theme: 'citTheme',
      });

      const sub = this.editor.onDidChangeModelContent(() => {
        const text = this.editor.getValue();
        this.valueChange.emit(text);
        if (this.getMarkers) {
          const markers = this.getMarkers(text) || [];
          monaco.editor.setModelMarkers(this.editor.getModel()!, 'citlang-diagnostics', markers);
        }
      });
      this.disposers.push(() => sub.dispose());
    });

    if (this.getMarkers) {
      const markers = this.getMarkers(this.value) || [];
      this.monaco.editor.setModelMarkers(this.editor.getModel()!, 'citlang-diagnostics', markers);
    }
  }

  ngOnDestroy() {
    for (const f of this.disposers) try { f(); } catch {}
    if (this.editor) this.editor.dispose();
  }

  // ---- Language + theme ----
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
          [/\[/, { token: 'expr.bracket', next: '@expr' }],
          [/\{/, { token: 'lit.brace', next: '@lit' }],
          [/\+/, 'plus'],
        ],
        expr: [
          [/\\./, 'escape'],
          [/\[%s\]/, 'placeholder'],
          [/%s/, 'placeholder'],
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
      ],
      colors: {},
    });
  }
}

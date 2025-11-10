import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as monaco from 'monaco-editor';

import { CitationEngineService } from '../citation-engine.service';
import { MonacoEditorDirective } from '../shared/monaco-editor.directive';

interface ComboRow {
  label: string;
  inputs: (string | null)[];
  output: string;
}

@Component({
  selector: 'app-lab',
  standalone: true,
  imports: [CommonModule, FormsModule, MonacoEditorDirective],
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss'],
})
export class LabComponent {
  // ---------------------------------------------------------
  // View state
  // ---------------------------------------------------------
  view: 'builder' | 'combos' = 'builder';

  // ---------------------------------------------------------
  // Core state: start EMPTY per your request
  // ---------------------------------------------------------
  template = '';
  argNames: string[] = [];
  argValues: string[] = [];
  nullMask: boolean[] = [];
  comboSelectMask: boolean[] = [];

  specText = '';
  showHTML = false;
  diag: { name: string; got: string; want: string; pass: boolean }[] | null = null;
  newArgName = '';

  /** Stores collapsed substrings; the Nth entry corresponds to the Nth [*] in the template. */
  private foldPieces: string[] = [];


  // Monaco directive ref (to access editor/selection)
  @ViewChild(MonacoEditorDirective) monacoDir?: MonacoEditorDirective;

  // ---------------------------------------------------------
  // Folding state
  // ---------------------------------------------------------
  /** Monotonic id for fold tokens like [*1], [*2], ... */
  private foldSeq = 1;
  /** Map token id -> original collapsed substring (e.g., '[[a]+[b]+{, }]') */
  private foldMap = new Map<number, string>();

  // ---------------------------------------------------------
  // Derived getters (expanded text!)
  // ---------------------------------------------------------
  get expandedTemplate(): string {
    return this.expandFolds(this.template);
  }

  get issues(): string[] {
    return this.engine.lintTemplate(this.expandedTemplate);
  }

  get args(): string[] {
    return this.argNames.join(',').split(',').map(s => s.trim()).filter(Boolean);
  }

  get preparedValues(): (string | null)[] {
    return this.argValues.map((v, i) => (this.nullMask[i] ? null : v));
  }

  get result(): string {
    try {
      // Always render from expanded template
      return this.engine.format(this.expandedTemplate, ...this.preparedValues) || '';
    } catch (e: any) {
      return `Engine error: ${e?.message ?? e}`;
    }
  }

  constructor(private engine: CitationEngineService) {}

  // ---------------------------------------------------------
  // Builder actions
  // ---------------------------------------------------------
  runExtract(): void {
    const extracted = this.engine.extractBracketArgs(this.specText || '');
    if (!extracted.length) return;

    this.argNames = extracted;
    this.argValues = Array.from({ length: extracted.length }, (_, i) => this.argValues[i] ?? '');
    this.nullMask  = Array.from({ length: extracted.length }, (_, i) => this.nullMask[i] ?? false);
    this.syncComboMask();
  }

  clear(): void {
    this.argValues = this.args.map(() => '');
    this.nullMask  = this.args.map(() => false);
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.result || '');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = this.result || '';
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
      console.warn('Clipboard API failed; used execCommand fallback.', err);
    }
  }

  insertToken(t: string): void {
    // Insert at end (simple); can be improved to insert at caret
    this.template += t;
  }

  onMonacoChange(val: string): void {
    this.template = val; // issues/result recalc from getters
  }

  // ---------------------------------------------------------
  // Folding: expand, hover, fold selection, unfold all
  // ---------------------------------------------------------

  /** Replace all [*id] with their original substrings */
  /** Return template with all [*] replaced by their current pieces, non-destructive */
  private expandFolds(text: string): string {
    let i = 0;
    return text.replace(/\[\*\]/g, () => this.foldPieces[i++] ?? '');
  }



  /** Hover provider callback: id -> content */
  /** Hover callback: return the Nth collapsed piece for the Nth [*] */
  getFoldHover = (ordinal: number): string | undefined => {
  return this.foldPieces[ordinal];
};


  /** Try to fold the currently selected text if it is a balanced [ ... ] group */
  foldSelection(): void {
    const ed = this.monacoDir?.getEditor();
    const model = ed?.getModel();
    if (!ed || !model) return;

    const sel = ed.getSelection();
    if (!sel) return;

    const range = monaco.Range.lift(sel);
    const selected = model.getValueInRange(range);

    if (!this.isBalancedBracketedExpr(selected)) {
      // optional: show a toast/warning
      return;
    }

    // Append to the fold pieces list; this becomes the next ordinal
    this.foldPieces.push(selected);

    // Replace selection with the visible token [*]
    ed.executeEdits('fold', [{ range, text: '[*]' }]);
    this.template = model.getValue();
}


  /** Expand all fold tokens and clear the map */
  unfoldAll(): void {
  const ed = this.monacoDir?.getEditor();
  const model = ed?.getModel();

  const expand = (text: string) => {
    let idx = 0;
    return text.replace(/\[\*\]/g, () => this.foldPieces[idx++] ?? '');
  };

  if (ed && model) {
    const fullRange = model.getFullModelRange();
    const expanded = expand(model.getValue());
    ed.executeEdits('unfold-all', [{ range: fullRange, text: expanded }]);
    this.template = expanded;
  } else {
    this.template = expand(this.template);
  }
  this.foldPieces = [];
}


  /** Validate selection is exactly one bracketed expression: starts '[' ends ']' and balances both [] and {} */
  private isBalancedBracketedExpr(s: string): boolean {
    if (!s || s[0] !== '[' || s[s.length - 1] !== ']') return false;
    let b = 0, c = 0;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\\') { i++; continue; } // skip escaped
      if (ch === '[') b++;
      if (ch === ']') b--;
      if (ch === '{') c++;
      if (ch === '}') c--;
      if (b < 0 || c < 0) return false;
    }
    return b === 0 && c === 0;
  }

  // ---------------------------------------------------------
  // Monaco diagnostics (run on expanded text!)
  // ---------------------------------------------------------
  getMonacoMarkers = (text: string): monaco.editor.IMarkerData[] => {
    const expanded = this.expandFolds(text);
    const markers: monaco.editor.IMarkerData[] = [];

    // Structural pass on expanded
    const stack: Array<{ ch: string; i: number }> = [];
    for (let i = 0; i < expanded.length; i++) {
      const ch = expanded[i];
      if (ch === '[' || ch === '{') stack.push({ ch, i });
      if (ch === ']' || ch === '}') {
        const last = stack.pop();
        const mismatch = !last ||
          (last.ch === '[' && ch !== ']') ||
          (last.ch === '{' && ch !== '}');
        if (mismatch) {
          markers.push({
            severity: monaco.MarkerSeverity.Error,
            message: `Unmatched ${ch}`,
            startLineNumber: 1,
            startColumn: i + 1,
            endLineNumber: 1,
            endColumn: i + 2,
          });
        }
      }
    }
    for (const s of stack) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: `Unclosed ${s.ch}`,
        startLineNumber: 1,
        startColumn: s.i + 1,
        endLineNumber: 1,
        endColumn: s.i + 2,
      });
    }

    // %s drift warning (expanded text!)
    const placeholderCount = (expanded.match(/%s/g) || []).length;
    const argCount = this.args.length;
    if (placeholderCount !== argCount) {
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: `%s count (${placeholderCount}) differs from Arguments count (${argCount})`,
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 2,
      });
    }
    return markers;
  };

  // ---------------------------------------------------------
  // Argument list management
  // ---------------------------------------------------------
  addArg(alsoInsertPlaceholder = false): void {
    const name = (this.newArgName || `Arg${this.argNames.length + 1}`).trim();
    if (!name) return;

    this.argNames         = [...this.argNames, name];
    this.argValues        = [...this.argValues, ''];
    this.nullMask         = [...this.nullMask, false];
    this.comboSelectMask  = [...this.comboSelectMask, true];

    this.newArgName = '';
    this.syncComboMask();

    if (alsoInsertPlaceholder) {
      this.insertToken('[%s]');
    }
  }

  removeArg(i: number): void {
    if (i < 0 || i >= this.argNames.length) return;
    const rm = <T>(a: T[]) => a.slice(0, i).concat(a.slice(i + 1));
    this.argNames        = rm(this.argNames);
    this.argValues       = rm(this.argValues);
    this.nullMask        = rm(this.nullMask);
    this.comboSelectMask = rm(this.comboSelectMask);
    this.syncComboMask();
  }

  /** Fill each argument value with its display name (handy for punctuation checks) */  
  autofillNames(): void {    this.argValues = this.args.map((n) => n);    this.nullMask  = this.args.map(() => false);  }

  // ---------------------------------------------------------
  // Combinations tester
  // ---------------------------------------------------------
  private syncComboMask(): void {
    this.comboSelectMask = Array.from(
      { length: this.args.length },
      (_, i) => this.comboSelectMask[i] ?? true
    );
  }

  private selectedIndices(): number[] {
    return this.args.map((_, i) => i).filter(i => this.comboSelectMask[i]);
  }

  private subsets(idxs: number[]): number[][] {
    const out: number[][] = [];
    const n = idxs.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      const sub: number[] = [];
      for (let b = 0; b < n; b++) if (mask & (1 << b)) sub.push(idxs[b]);
      out.push(sub);
    }
    return out;
  }

  get comboCount(): number {
    const k = this.selectedIndices().length;
    return k ? (1 << k) - 1 : 0;
  }

  get comboRows(): ComboRow[] {
    const idxs = this.selectedIndices();
    if (!idxs.length) return [];

    const total = (1 << idxs.length) - 1;
    if (total > 4096) {
      return [{
        label: '—',
        inputs: [],
        output: `Too many combinations selected (${total}). Reduce selection to ≤ 4096.`
      }];
    }

    const rows: ComboRow[] = [];
    for (const sub of this.subsets(idxs)) {
      const inputs = this.args.map((_, i) =>
        sub.includes(i) ? (this.nullMask[i] ? null : this.argValues[i]) : null
      );

      let output = '';
      try {
        output = this.engine.format(this.expandedTemplate, ...inputs);
      } catch (e: any) {
        output = `Engine error: ${e?.message ?? e}`;
      }

      const label = sub.map(i => this.args[i]).join(', ');
      rows.push({ label, inputs, output });
    }
    return rows;
  }
}

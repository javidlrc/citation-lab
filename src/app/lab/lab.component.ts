import { Component, ElementRef, ViewChild  } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CitationEngineService } from '../citation-engine.service';
import { SyntaxHighlighterService } from '../syntax-highlighter.service';
import { MonacoEditorDirective } from '../shared/monaco-editor.directive';


interface TestCase {
  name: string;
  tpl: string;
  vals: (string | null)[];
  want: string;
}

interface ComboRow {
  label: string;
  inputs: (string | null)[];
  output: string;
}

@Component({
  selector: 'app-lab',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lab.component.html',
  styleUrls: ['./lab.component.scss'],
})
export class LabComponent {

  @ViewChild('syntaxPre', { static: false }) syntaxPre?: ElementRef<HTMLPreElement>;

  highlightedTemplate = '';

  constructor(
    private engine: CitationEngineService,
    private syntax: SyntaxHighlighterService
  ) {}

  updateHighlight() {
    this.highlightedTemplate = this.syntax.highlightBrackets(this.template);
  }

  // call once on init
  ngOnInit() {
    this.updateHighlight();
  }

  // ---- NEW: simple in-component "routing" between Builder and Combinations
  view: 'builder' | 'combos' = 'builder';

  template =
    '[[[[[[%s]+{ }+[%s]]+{, }+[{<i>}+[%s]+{</i>}]]+{ }+[{(}+[[%s]+{: }+[[%s]+{, }+[%s]]]+{)}]]+{, }+[%s]]+{; }+[{digital images, }+[{<i>}+[%s]+{</i>}]+{ (}+[[[%s]]+{ : }+[{accessed }+[%s]]]+{)}]]]+{.}';

  argNames = [
    'AuthorGiven','AuthorSurname','Title','PublishPlace','Publisher',
    'PublishYear','PageNo','RepositoryName','RepositoryURL','AccessedDate'
  ];

  argValues: string[] = [
    'William Henry','Perrin',
    'History of Alexander, Union and Pulaski Counties, Illinois',
    'Chicago','O.L. Baskin & Company Historical Publishers','1883',
    '191','FamilySearch','https://familysearch.org','24 January 2022'
  ];

  nullMask: boolean[] = this.argNames.map(() => false);
  // ---- NEW: which args to include when generating the power set
  comboSelectMask: boolean[] = this.argNames.map(() => true);

  specText = '';
  showHTML = false;
  diag: { name: string; got: string; want: string; pass: boolean }[] | null = null;

  // ---------- Derived state ----------
  get issues(): string[] { return this.engine.lintTemplate(this.template); }
  get args(): string[] { return this.argNames.join(',').split(',').map(s => s.trim()).filter(Boolean); }
  get preparedValues(): (string | null)[] { return this.argValues.map((v, i) => (this.nullMask[i] ? null : v)); }

  get result(): string {
    try { return this.engine.format(this.template, ...this.preparedValues) || ''; }
    catch (e: any) { return `Engine error: ${e?.message ?? e}`; }
  }

  // ---------- Builder actions ----------

  runExtract() {
    const extracted = this.engine.extractBracketArgs(this.specText || '');
    if (!extracted.length) return;
    this.argNames = extracted;
    this.argValues = Array.from({ length: extracted.length }, (_, i) => this.argValues[i] ?? '');
    this.nullMask = Array.from({ length: extracted.length }, (_, i) => this.nullMask[i] ?? false);
    this.syncComboMask(); // keep combinations checklist aligned
  }

  autoConvertSpecToTemplate() {
    const spec = (this.specText || '').toString();
    if (!spec.trim()) return;

    const args: string[] = [];
    const parts: string[] = [];
    let i = 0;
    const lit = (s: string) => '{' + s.replace(/}/g, ')') + '}';

    while (i < spec.length) {
      const start = spec.indexOf('[', i);
      if (start === -1) { const tail = spec.slice(i); if (tail) parts.push(lit(tail)); break; }
      if (start > i) { const chunk = spec.slice(i, start); if (chunk) parts.push(lit(chunk)); }
      const end = spec.indexOf(']', start + 1);
      if (end === -1) { const chunk = spec.slice(start); parts.push(lit(chunk)); break; }
      const label = spec.slice(start + 1, end).trim();
      args.push(label);
      parts.push('[%s]');
      i = end + 1;
    }

    const tpl = parts.length ? '[' + parts.join('+') + ']' : '';
    this.template = tpl;
    this.argNames = args;
    this.argValues = Array.from({ length: args.length }, (_, idx) => this.argValues[idx] ?? '');
    this.nullMask = Array.from({ length: args.length }, (_, idx) => this.nullMask[idx] ?? false);
    this.syncComboMask(); // keep combinations checklist aligned
  }

  clear() {
    this.argValues = this.args.map(() => '');
    this.nullMask = this.args.map(() => false);
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

  // ---------- NEW: Combinations Tester ----------

  // keep the checkbox list length in sync with args length
  private syncComboMask() {
    this.comboSelectMask = Array.from({ length: this.args.length }, (_, i) => this.comboSelectMask[i] ?? true);
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

  // Total count (for UI)
  get comboCount(): number {
    const k = this.selectedIndices().length;
    return k ? (1 << k) - 1 : 0;
    // Note: grows quickly; 12 checked -> 4095 rows
  }

  // The rendered rows
  get comboRows(): ComboRow[] {
    const idxs = this.selectedIndices();
    if (!idxs.length) return [];

    // soft guard to protect UI from huge lists
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
      const inputs = this.args.map((_, i) => sub.includes(i) ? (this.nullMask[i] ? null : this.argValues[i]) : null);
      let output = '';
      try { output = this.engine.format(this.template, ...inputs); }
      catch (e: any) { output = `Engine error: ${e?.message ?? e}`; }
      const label = sub.map(i => this.args[i]).join(', ');
      rows.push({ label, inputs, output });
    }
    return rows;
  }

  async copyAllCombos(): Promise<void> {
    const lines = this.comboRows.map((r, i) => `${i + 1}. [${r.label || '—'}]\n${r.output}`).join('\n\n');
    try { await navigator.clipboard.writeText(lines); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = lines; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
    }
  }

  autofillNames() {
  this.argValues = this.args.map((n) => n);
  this.nullMask = this.args.map(() => false);
  }

  onTemplateChange(val: string) {
  this.template = val;
  this.updateHighlight();
  }

  syncScroll(ev: Event) {
    const ta = ev.target as HTMLTextAreaElement;
    const pre = this.syntaxPre?.nativeElement;
    if (!pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  insertToken(t: string) {
    this.template += t;
    this.updateHighlight();        // keep overlay in sync after programmatic edits
    // Optionally move caret to end; omitted on purpose.
  }
  


  

}

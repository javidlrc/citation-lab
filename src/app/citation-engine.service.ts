import { Injectable } from '@angular/core';

export type Maybe = string | null | undefined;

@Injectable({ providedIn: 'root' })
export class CitationEngineService {
  format(template: string, ...attributes: Maybe[]): string {
    const filled = this.interpolate(template, attributes);
    return this.evalExpr(filled);
  }

  private interpolate(template: string, attributes: Maybe[]): string {
    let i = 0;
    return template.replace(/%s/g, () => (attributes[i++] ?? ''));
  }

  private evalExpr(expr: string): string {
    if (!expr) return expr;
    const c = expr.charAt(0);
    if (c !== '[' && c !== '{') return expr;
    const statements = this.findStatements(expr);

    const parsed = statements.map((statement) => {
      const addendContents: string[] = [];
      const expressions: string[] = [];
      for (const addend of statement) {
        if (addend.startsWith('[') && addend.endsWith(']')) {
          const inner = this.evalExpr(addend.slice(1, -1));
          expressions.push(inner);
          addendContents.push(inner);
        } else if (addend.startsWith('{') && addend.endsWith('}')) {
          addendContents.push(addend.slice(1, -1));
        }
      }
      return expressions.some((e) => e === '') ? expressions.join('') : addendContents.join('');
    });

    return parsed.join('');
  }

  private findStatements(expression: string): string[][] {
    const statements: string[][] = [];
    let currentStatement: string[] = [];
    let currentAddend = '';
    let bracketCount = 0;
    let braceCount = 0;
    let currentSearch = expression.charAt(0);

    for (let i = 0; i < expression.length; i++) {
      const ch = expression.charAt(i);

      // handle escapes for [], {}
      if (ch === '\\' && i < expression.length - 1) {
        const next = expression.charAt(i + 1);
        if (next === '[' || next === ']' || next === '{' || next === '}') {
          if (currentSearch !== '{') currentAddend += ch;
          i++; currentAddend += next; continue;
        }
      }

      currentAddend += ch;
      if (ch === '[') bracketCount++;
      if (ch === ']') bracketCount--;
      if (ch === '{') braceCount++;
      if (ch === '}') braceCount--;

      const atEnd =
        (currentSearch === '[' && bracketCount === 0) ||
        (currentSearch === '{' && braceCount === 0);

      if (atEnd) {
        if (i === expression.length - 1) {
          currentStatement.push(currentAddend);
          statements.push(currentStatement);
          currentAddend = '';
          currentStatement = [];
        } else if (expression.charAt(i + 1) === '+') {
          currentStatement.push(currentAddend);
          currentAddend = '';
          i++; // skip '+'
          currentSearch = expression.charAt(i + 1);
        } else {
          currentStatement.push(currentAddend);
          statements.push(currentStatement);
          currentAddend = '';
          currentStatement = [];
          currentSearch = expression.charAt(i + 1);
        }
      }
    }
    return statements;
  }

  // helpers for UI
  lintTemplate(tpl: string): string[] {
    const issues: string[] = [];
    const stack: { ch: string; idx: number }[] = [];

    for (let i = 0; i < tpl.length; i++) {
      const ch = tpl[i];
      if (ch === '[') stack.push({ ch: '[', idx: i });
      if (ch === '{') stack.push({ ch: '{', idx: i });
      if (ch === ']') { const last = stack.pop(); if (!last || last.ch !== '[') issues.push(`Unmatched ']' at ${i}`); }
      if (ch === '}') { const last = stack.pop(); if (!last || last.ch !== '{') issues.push(`Unmatched '}' at ${i}`); }
    }
    if (stack.length) issues.push('Unclosed bracket/brace detected');
    if (/\{\s*\}/.test(tpl)) issues.push('Warning: empty {} literal');
    if (/\+\s*\+/.test(tpl)) issues.push("Warning: doubled '+' between addends");
    return issues;
  }

  extractBracketArgs(spec: string): string[] {
    const matches = spec.match(/\[[^\[\]]+\]/g) || [];
    const labels = matches.map((m) => m.slice(1, -1).trim());
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of labels) if (!seen.has(l)) { seen.add(l); out.push(l); }
    return out;
  }
}

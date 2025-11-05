import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SyntaxHighlighterService {
  highlightBrackets(input: string): string {
    const colors = ['#ec4899', '#f97316', '#3b82f6', '#22c55e', '#a855f7'];
    let level = 0;
    const stack: string[] = [];

    return input.replace(/[\[\]{}]/g, (m) => {
      if (m === '[' || m === '{') {
        const color = colors[level % colors.length];
        stack.push(m);
        level++;
        return `<span style="color:${color};font-weight:600">${m}</span>`;
      } else {
        const open = stack.pop();
        level = Math.max(0, level - 1);
        const color = colors[level % colors.length];
        return `<span style="color:${color};font-weight:600">${m}</span>`;
      }
    });
  }
}
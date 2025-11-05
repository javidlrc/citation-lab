import { Component } from '@angular/core';
import { LabComponent } from './lab/lab.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LabComponent],
  template: `<app-lab></app-lab>`,
})
export class AppComponent {}

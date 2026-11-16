import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-contact',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './contact.component.html',
    styleUrl: './contact.component.css'
})
export class ContactComponent {
    name = '';
    email = '';
    subject = 'Partenariat API';
    message = '';
    sent = false;

    submit(): void {
        this.sent = true;
    }
}

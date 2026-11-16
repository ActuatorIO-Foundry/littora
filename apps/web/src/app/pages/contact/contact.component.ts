import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, inject } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../../shared/icon.component";
@Component({
  selector: "app-contact",
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: "./contact.component.html",
  styleUrl: "./contact.component.css",
})
export class ContactComponent {
  private readonly cdr = inject(ChangeDetectorRef);
  name = "";
  email = "";
  subject = "Une question";
  message = "";
  status = "";
  async copyMessage(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        `Sujet : ${this.subject}\nNom : ${this.name}\nEmail : ${this.email}\n\n${this.message}`,
      );
      this.status = "Message copié. Aucun message n’a été envoyé.";
    } catch {
      this.status =
        "La copie a été refusée par le navigateur. Aucun message n’a été envoyé.";
    } finally {
      this.cdr.markForCheck();
    }
  }
}

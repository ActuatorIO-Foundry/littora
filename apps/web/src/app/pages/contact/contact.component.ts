import { CommonModule } from "@angular/common";
import { ChangeDetectorRef, Component, OnInit, inject } from "@angular/core";
import { HttpErrorResponse } from "@angular/common/http";
import { LittoraService } from "@littora/api-client";
import { firstValueFrom } from "rxjs";
import { FormsModule } from "@angular/forms";
import { IconComponent } from "../../shared/icon.component";
@Component({
  selector: "app-contact",
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  templateUrl: "./contact.component.html",
  styleUrl: "./contact.component.css",
})
export class ContactComponent implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly api = inject(LittoraService);
  readonly topics = {question:"Une question", correction:"Une donnée à corriger", territory:"Une commune ou un territoire", partnership:"Un partenariat"};
  email = "";
  subject: keyof typeof this.topics = "question";
  message = "";
  status = "";
  available = false;
  checking = true;
  busy = false;
  async ngOnInit() {
    try { this.available = (await firstValueFrom(this.api.getContactAvailability())).available === true; }
    catch { this.available = false; }
    finally { this.checking = false; this.cdr.markForCheck(); }
  }
  async submit() {
    if (this.busy || this.checking || !this.message.trim()) return;
    if (!this.available) return this.copyMessage();
    this.busy = true;
    this.status = "";
    try {
      const reply = await firstValueFrom(this.api.submitContact$Response({body:{email:this.email, topic:this.subject, message:this.message}}));
      if (reply.status !== 201 || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(reply.body?.reference ?? '')) throw new Error();
      this.status = "Message reçu par Littora. Référence : " + reply.body.reference;
      this.message = ""; this.email = "";
    } catch (err) {
      this.status = err instanceof HttpErrorResponse && err.status === 429
        ? "Limite d’envoi atteinte. Réessayez dans une heure. Votre texte est conservé sur cette page."
        : "Réception non confirmée. Votre texte est conservé sur cette page ; vous pouvez réessayer.";
    } finally { this.busy = false; this.cdr.markForCheck(); }
  }
  async copyMessage(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        `Sujet : ${this.topics[this.subject]}\nEmail : ${this.email}\n\n${this.message}`,
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

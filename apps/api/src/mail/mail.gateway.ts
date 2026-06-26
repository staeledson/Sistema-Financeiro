import { Injectable, Logger } from "@nestjs/common";

export interface MailProvider {
  send(to: string, subject: string, html: string): Promise<void>;
}

@Injectable()
export class MailGateway {
  private readonly logger = new Logger(MailGateway.name);
  private readonly provider: MailProvider | null;

  constructor() {
    const apiKey = process.env["MAIL_API_KEY"];
    if (apiKey) {
      this.provider = createResendProvider(apiKey);
    } else {
      this.provider = null;
    }
  }

  async send(to: string, subject: string, html: string): Promise<void> {
    if (this.provider) {
      await this.provider.send(to, subject, html);
    } else {
      this.logger.log(`[DEV MAIL] to=${to} subject="${subject}" html=${html.slice(0, 120)}`);
    }
  }
}

function createResendProvider(apiKey: string): MailProvider {
  return {
    async send(to, subject, html) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "noreply@sistema-financeiro.app", to, subject, html }),
      });
      if (!res.ok) throw new Error(`Resend error ${res.status}: ${await res.text()}`);
    },
  };
}

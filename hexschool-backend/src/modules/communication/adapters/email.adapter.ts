import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';

export interface EmailCredentials {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
}

export interface EmailSendInput {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSendResult {
  accepted: boolean;
  providerMsgId?: string;
  error?: string;
}

/**
 * Email delivery over SMTP (roadmap M17 §4). Prefers the school's saved
 * `email.*` settings; when a school has not configured SMTP it falls back
 * to the boot-time `smtp.*` env (Mailpit in dev), the same transport the
 * M02 interim processor used, so email keeps working out of the box.
 */
@Injectable()
export class EmailAdapter {
  private readonly logger = new Logger(EmailAdapter.name);
  private readonly envFrom: string;
  private readonly envTransport: Transporter;

  constructor(private readonly config: ConfigService) {
    this.envFrom = config.getOrThrow<string>('smtp.from');
    const user = config.get<string>('smtp.user');
    this.envTransport = createTransport({
      host: config.getOrThrow<string>('smtp.host'),
      port: config.getOrThrow<number>('smtp.port'),
      secure: false,
      auth: user ? { user, pass: config.get<string>('smtp.pass') } : undefined,
    });
  }

  async send(
    input: EmailSendInput,
    credentials: EmailCredentials,
  ): Promise<EmailSendResult> {
    const useSchool = credentials.enabled && credentials.host;
    const transport = useSchool
      ? createTransport({
          host: credentials.host,
          port: credentials.port,
          secure: credentials.port === 465,
          auth: credentials.user
            ? { user: credentials.user, pass: credentials.pass }
            : undefined,
        })
      : this.envTransport;

    const from =
      useSchool && credentials.fromEmail
        ? `${credentials.fromName || 'School'} <${credentials.fromEmail}>`
        : this.envFrom;

    try {
      const info = (await transport.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
      })) as { messageId?: string };
      return { accepted: true, providerMsgId: info.messageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Email send failed: ${message}`);
      throw error;
    }
  }
}

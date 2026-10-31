import nodemailer, { Transporter } from 'nodemailer';
import { NotifierConfig } from './config';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
}

export interface Mailer {
  /** Resolves once the SMTP server accepted the message. */
  send(message: MailMessage): Promise<void>;
}

/**
 * Builds the SMTP mailer from the configuration. A transport can be passed in
 * so tests never talk to a real server.
 */
export function createMailer(config: NotifierConfig, transport?: Transporter): Mailer {
  const transporter = transport ?? nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });

  return {
    async send(message) {
      const result = await transporter.sendMail({
        from: config.from,
        to: config.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: message.attachments,
      });
      if (result.rejected && result.rejected.length > 0) {
        throw new Error(`SMTP server rejected: ${result.rejected.join(', ')}`);
      }
    },
  };
}

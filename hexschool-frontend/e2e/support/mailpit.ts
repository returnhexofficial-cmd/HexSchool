/**
 * Mailpit helpers — assert on mail the app actually sent, instead of clicking
 * through the Mailpit web UI.
 *
 * Mailpit is the SMTP catcher in `hexschool-backend/docker-compose.yml`
 * (1025 SMTP, 8025 web + API). Used by M02 (OTP, password reset) and M17
 * (notices, invoices, bulk sends).
 */

const MAILPIT = process.env.QA_MAILPIT_URL ?? 'http://localhost:8025';

export type MailpitMessage = {
  ID: string;
  From: { Address: string; Name: string };
  To: Array<{ Address: string; Name: string }>;
  Subject: string;
  Created: string;
  Snippet: string;
};

/** Delete every captured message. Call before a flow that asserts on mail. */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
}

export async function listMessages(limit = 50): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=${limit}`);
  if (!res.ok) throw new Error(`Mailpit list failed: ${res.status}`);
  const body = (await res.json()) as { messages: MailpitMessage[] };
  return body.messages ?? [];
}

/** Full source of one message — headers plus the text and HTML parts. */
export async function getMessage(
  id: string,
): Promise<{ Text: string; HTML: string; Subject: string }> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit fetch failed: ${res.status}`);
  return (await res.json()) as { Text: string; HTML: string; Subject: string };
}

/**
 * Poll until a message to `address` arrives. Mail is queued through BullMQ, so
 * it lands asynchronously — poll, never sleep-and-hope (the lesson the backend
 * e2e suites already encode).
 */
export async function waitForMessageTo(
  address: string,
  opts: { subjectMatch?: RegExp; timeoutMs?: number } = {},
): Promise<MailpitMessage> {
  const deadline = Date.now() + (opts.timeoutMs ?? 15_000);
  let lastSeen = 0;

  while (Date.now() < deadline) {
    const messages = await listMessages();
    lastSeen = messages.length;
    const hit = messages.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === address.toLowerCase()) &&
        (!opts.subjectMatch || opts.subjectMatch.test(m.Subject)),
    );
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 400));
  }

  throw new Error(
    `No mail to ${address}${opts.subjectMatch ? ` matching ${opts.subjectMatch}` : ''} ` +
      `within ${opts.timeoutMs ?? 15_000}ms (${lastSeen} message(s) in the mailbox)`,
  );
}

/** Pull the 6-digit OTP out of a verification email. */
export async function extractOtp(messageId: string): Promise<string> {
  const msg = await getMessage(messageId);
  const match = /\b(\d{6})\b/.exec(`${msg.Text}\n${msg.HTML}`);
  if (!match) throw new Error(`No 6-digit code in message ${messageId}`);
  return match[1];
}

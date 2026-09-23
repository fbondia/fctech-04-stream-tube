const mailpitUrl = `http://${process.env.MAIL_HOST ?? 'mailpit'}:8025`;

export interface MailpitMessage {
  ID: string;
  To: Array<{ Address: string }>;
  From: { Address: string };
  Subject: string;
}

export interface MailpitMessageDetail {
  HTML: string;
}

export async function getMailpitMessages(): Promise<MailpitMessage[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  if (!res.ok)
    throw new Error(`Mailpit messages request failed: ${res.status}`);
  const data = (await res.json()) as { messages?: MailpitMessage[] };
  return data.messages ?? [];
}

export async function getMailpitMessage(
  id: string,
): Promise<MailpitMessageDetail> {
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message request failed: ${res.status}`);
  return (await res.json()) as MailpitMessageDetail;
}

export async function clearMailpitMessages(): Promise<void> {
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
}

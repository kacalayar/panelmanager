import { decryptSecret, eq, notificationChannels, type PanelDb } from "@panelmanager/db";

export interface NotificationPayload {
  title: string;
  message: string;
  level: "info" | "success" | "error";
}

export async function sendNotification(
  db: PanelDb,
  secret: string,
  payload: NotificationPayload
): Promise<void> {
  const channels = db
    .select()
    .from(notificationChannels)
    .where(eq(notificationChannels.enabled, true))
    .all();

  await Promise.allSettled(
    channels.map(async (ch) => {
      const cfg = JSON.parse(decryptSecret(ch.configEncrypted, secret)) as Record<string, string>;
      if (ch.type === "discord" && cfg.webhookUrl) {
        const color =
          payload.level === "success" ? 0x22c55e : payload.level === "error" ? 0xef4444 : 0x3b82f6;
        await fetch(cfg.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [
              {
                title: payload.title,
                description: payload.message,
                color,
                timestamp: new Date().toISOString(),
              },
            ],
          }),
        });
      } else if (ch.type === "telegram" && cfg.botToken && cfg.chatId) {
        const text = `*${payload.title}*\n${payload.message}`;
        await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: cfg.chatId,
            text,
            parse_mode: "Markdown",
          }),
        });
      } else if (ch.type === "webhook" && cfg.url) {
        await fetch(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
    })
  );
}

import webpush from "web-push";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

export interface SubInfo {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const configured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

if (configured) {
  webpush.setVapidDetails(
    "mailto:financas@app.local",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

export async function sendPush(sub: SubInfo, payload: PushPayload): Promise<void> {
  if (!configured) return;
  await webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    JSON.stringify(payload),
  );
}

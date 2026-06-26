import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { CurrentUserGuard, AuthenticatedUser } from "../auth/current-user.guard";
import { prisma } from "../database";

interface SubscribeBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

@Controller("push")
@UseGuards(CurrentUserGuard)
export class PushController {
  @Post("subscribe")
  async subscribe(@Body() body: SubscribeBody, @Req() req: { user: AuthenticatedUser }) {
    await prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      update: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      create: {
        workspaceId: req.user.workspaceId,
        userId: req.user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
      },
    });
    return { ok: true };
  }

  @Get("vapid-public-key")
  getVapidKey() {
    return { key: process.env.VAPID_PUBLIC_KEY ?? "" };
  }
}

import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard, AuthenticatedUser } from "../auth/current-user.guard";
import { prisma } from "../database";

const subscribeBody = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
});

@Controller("push")
@UseGuards(CurrentUserGuard)
export class PushController {
  /** O endpoint identifica o navegador: se outro usuário entrar no mesmo aparelho, a inscrição passa a ser dele. */
  @Post("subscribe")
  async subscribe(@Body() body: unknown, @Req() req: { user: AuthenticatedUser }) {
    const b = subscribeBody.parse(body);
    await prisma.pushSubscription.upsert({
      where: { endpoint: b.endpoint },
      update: { p256dh: b.keys.p256dh, auth: b.keys.auth, userId: req.user.id, workspaceId: req.user.workspaceId },
      create: {
        workspaceId: req.user.workspaceId,
        userId: req.user.id,
        endpoint: b.endpoint,
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
      },
    });
    return { ok: true };
  }

  @Get("vapid-public-key")
  getVapidKey() {
    return { key: process.env.VAPID_PUBLIC_KEY ?? "" };
  }
}

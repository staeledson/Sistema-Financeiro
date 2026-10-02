import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ChatService } from "./chat.service";
import type { AuthenticatedUser } from "../auth/current-user.guard";

const sendBody = z.object({
  message: z.string().trim().min(1).max(4000),
  conversationId: z.string().min(1).optional(),
});

@Controller()
@UseGuards(CurrentUserGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post("chat")
  async send(@Body() body: unknown, @Req() req: { user: AuthenticatedUser }) {
    const b = sendBody.parse(body);
    return this.chat.send(req.user.workspaceId, req.user.id, b.message, b.conversationId);
  }

  @Get("chat")
  listConversations(@Req() req: { user: AuthenticatedUser }) {
    return this.chat.listConversations(req.user.workspaceId);
  }

  @Get("chat/:id")
  getHistory(@Param("id") id: string, @Req() req: { user: AuthenticatedUser }) {
    return this.chat.getHistory(req.user.workspaceId, id);
  }
}

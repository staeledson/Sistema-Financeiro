import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { CurrentUserGuard } from "../auth/current-user.guard";
import { ChatService } from "./chat.service";
import type { AuthenticatedUser } from "../auth/current-user.guard";

interface SendBody {
  message: string;
  conversationId?: string;
}

@Controller()
@UseGuards(CurrentUserGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post("chat")
  async send(@Body() body: SendBody, @Req() req: { user: AuthenticatedUser }) {
    return this.chat.send(req.user.workspaceId, req.user.id, body.message, body.conversationId);
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

import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";
import { runChat, FetchFn } from "./chat.gateway";
import { buildChart } from "./chart";

const MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";

@Injectable()
export class ChatService {
  private readonly apiKey = process.env.OPENROUTER_API_KEY ?? "";
  fetchFn: FetchFn = fetch;

  async send(
    workspaceId: string,
    userId: string,
    message: string,
    conversationId?: string,
  ) {
    let conversation = conversationId
      ? await prisma.chatConversation.findFirst({ where: { id: conversationId, workspaceId } })
      : null;

    if (conversationId && !conversation) throw new NotFoundException("conversa não encontrada");

    if (!conversation) {
      conversation = await prisma.chatConversation.create({
        data: { workspaceId, createdById: userId, title: message.slice(0, 80) },
      });
    }

    // Build full message history: prior messages + new user message
    const priorMessages = await prisma.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
    });
    const history = [
      ...priorMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const ctx = { workspaceId };
    const { answer, toolResults } = await runChat(this.apiKey, MODEL, history, ctx, this.fetchFn);

    const chartSpec = buildChart(toolResults);

    await prisma.chatMessage.create({ data: { conversationId: conversation.id, role: "user", content: message } });
    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: answer,
        toolResults: toolResults.length ? (toolResults as object[]) : undefined,
        chartSpec: chartSpec ?? undefined,
      },
    });

    return { conversationId: conversation.id, answer, chart: chartSpec, toolResults };
  }

  async getHistory(workspaceId: string, conversationId: string) {
    const conv = await prisma.chatConversation.findFirst({ where: { id: conversationId, workspaceId } });
    if (!conv) throw new NotFoundException("conversa não encontrada");
    const messages = await prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, content: true, toolResults: true, chartSpec: true, createdAt: true },
    });
    return { conversationId, title: conv.title, messages };
  }

  async listConversations(workspaceId: string) {
    return prisma.chatConversation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true },
    });
  }
}

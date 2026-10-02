import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";
import type { Prisma } from "../../generated/prisma/client";
import { runChat, FetchFn } from "./chat.gateway";
import { buildChart } from "./chart";

const MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini";
const HISTORY_LIMIT = 40;

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

    // grava a pergunta antes de chamar o modelo: uma falha do provedor não a perde
    await prisma.chatMessage.create({ data: { conversationId: conversation.id, role: "user", content: message } });

    const priorMessages = await prisma.chatMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    });
    const history = priorMessages.reverse().map((m) => ({ role: m.role, content: m.content }));

    const ctx = { workspaceId };
    const { answer, toolResults } = await runChat(this.apiKey, MODEL, history, ctx, this.fetchFn);

    const chartSpec = buildChart(toolResults);

    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: answer,
        toolResults: toolResults.length ? (toolResults as object[]) : undefined,
        chartSpec: chartSpec ? (chartSpec as unknown as Prisma.InputJsonValue) : undefined,
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

import { ForbiddenException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../database";
import { MailGateway } from "../mail/mail.gateway";

const INVITATION_TTL_DAYS = 7;
const ALLOWED_TO_INVITE = ["owner", "admin"];

@Injectable()
export class InvitationsService {
  constructor(private readonly mail: MailGateway) {}

  async create(workspaceId: string, invitedById: string, callerRole: string, body: { email: string; role?: string }) {
    if (!ALLOWED_TO_INVITE.includes(callerRole)) {
      throw new ForbiddenException("apenas owner ou admin podem convidar");
    }

    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await prisma.invitation.create({
      data: {
        workspaceId,
        email: body.email.toLowerCase(),
        role: (body.role ?? "member") as never,
        expiresAt,
        invitedById,
      },
      select: { id: true, token: true, email: true, role: true, expiresAt: true },
    });

    const appUrl = process.env["APP_URL"] ?? "http://localhost:5173";
    const link = `${appUrl}/convite/${invitation.token}`;
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });

    await this.mail.send(
      invitation.email,
      `Convite para o workspace "${workspace?.name ?? "financeiro"}"`,
      `<p>Você foi convidado para participar do workspace <strong>${workspace?.name}</strong>.</p>
       <p><a href="${link}">Aceitar convite</a></p>
       <p>Este link expira em ${INVITATION_TTL_DAYS} dias.</p>`,
    );

    return invitation;
  }

  async accept(token: string, callerEmail: string, callerUserId: string) {
    const invitation = await prisma.invitation.findUnique({ where: { token } });
    if (!invitation || invitation.status !== "pending") {
      throw new NotFoundException("convite inválido ou já utilizado");
    }
    if (new Date(invitation.expiresAt) < new Date()) {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "expired" } });
      throw new GoneException("convite expirado");
    }
    if (invitation.email.toLowerCase() !== callerEmail.toLowerCase()) {
      throw new ForbiddenException("e-mail não corresponde ao convite");
    }

    await prisma.$transaction([
      prisma.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId: callerUserId } },
        create: { workspaceId: invitation.workspaceId, userId: callerUserId, role: invitation.role },
        update: {},
      }),
      prisma.invitation.update({ where: { id: invitation.id }, data: { status: "accepted" } }),
    ]);

    return { ok: true, workspaceId: invitation.workspaceId };
  }

  async list(workspaceId: string) {
    return prisma.invitation.findMany({
      where: { workspaceId, status: "pending" },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(workspaceId: string, id: string, callerRole: string) {
    if (!ALLOWED_TO_INVITE.includes(callerRole)) throw new ForbiddenException("sem permissão");
    const inv = await prisma.invitation.findFirst({ where: { id, workspaceId } });
    if (!inv) throw new NotFoundException("convite não encontrado");
    await prisma.invitation.update({ where: { id }, data: { status: "revoked" } });
    return { id, status: "revoked" };
  }
}

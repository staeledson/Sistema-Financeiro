import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { APIError } from "better-auth/api";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { auth } from "./index";
import { prisma } from "../database";
import { viewerMayCall } from "./viewer-policy";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  workspaceId: string;
  role: string;
}

@Injectable()
export class CurrentUserGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthenticatedUser }>();
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) throw new UnauthorizedException();

    let session;
    try {
      session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
    } catch (error) {
      if (error instanceof APIError) throw new UnauthorizedException();
      throw error;
    }
    if (!session?.user) throw new UnauthorizedException();

    const requestedWorkspaceId = (req.headers as Record<string, string | string[] | undefined>)["x-workspace-id"] as string | undefined;

    let membership;
    if (requestedWorkspaceId) {
      membership = await prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: requestedWorkspaceId, userId: session.user.id } },
        select: { workspaceId: true, role: true },
      });
      if (!membership) throw new UnauthorizedException("não é membro deste workspace");
    } else {
      membership = await prisma.workspaceMember.findFirst({
        where: { userId: session.user.id },
        select: { workspaceId: true, role: true },
        orderBy: { createdAt: "asc" },
      });
      if (!membership) throw new UnauthorizedException();
    }

    if (membership.role === "viewer" && !viewerMayCall(req.method, req.url)) {
      throw new ForbiddenException("perfil leitor: somente leitura neste workspace");
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
    return true;
  }
}

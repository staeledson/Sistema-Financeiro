import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { auth } from "./index";
import { prisma } from "../database";

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

    const session = await auth.api.getSession({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
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

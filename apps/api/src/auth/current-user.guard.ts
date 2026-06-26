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

    const membership = await prisma.workspaceMember.findFirst({
      where: { userId: session.user.id },
      select: { workspaceId: true },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) throw new UnauthorizedException();

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      workspaceId: membership.workspaceId,
    };
    return true;
  }
}

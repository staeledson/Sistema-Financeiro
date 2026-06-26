import { prisma } from "../../src/database";
export { prisma };

export async function cleanDb() {
  await prisma.$transaction([
    prisma.workspaceMember.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.verification.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

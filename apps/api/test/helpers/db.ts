import { prisma } from "../../src/database";
export { prisma };

export async function cleanDb() {
  await prisma.$transaction([
    prisma.transactionDraft.deleteMany(),
    prisma.aiJob.deleteMany(),
    prisma.transactionTag.deleteMany(),
    prisma.transactionSplit.deleteMany(),
    prisma.goalContribution.deleteMany(),
    prisma.goal.deleteMany(),
    prisma.budget.deleteMany(),
    prisma.insight.deleteMany(),
    prisma.categoryRule.deleteMany(),
    prisma.transaction.deleteMany(),
    prisma.importBatch.deleteMany(),
    prisma.importMapping.deleteMany(),
    prisma.invitation.deleteMany(),
    prisma.businessProfile.deleteMany(),
    prisma.tag.deleteMany(),
    prisma.category.deleteMany(),
    prisma.bankAccount.deleteMany(),
    prisma.workspaceMember.deleteMany(),
    prisma.workspace.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.verification.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

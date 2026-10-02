-- Orçamento 50/30/20 por bucket: a tela sempre enviou needs/wants/savings.
ALTER TYPE "BudgetMethod" ADD VALUE 'needs';
ALTER TYPE "BudgetMethod" ADD VALUE 'wants';
ALTER TYPE "BudgetMethod" ADD VALUE 'savings';

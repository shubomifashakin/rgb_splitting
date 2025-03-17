-- CreateIndex
CREATE INDEX "Projects_status_nextPaymentDate_currentPlan_idx" ON "Projects"("status", "nextPaymentDate", "currentPlan");

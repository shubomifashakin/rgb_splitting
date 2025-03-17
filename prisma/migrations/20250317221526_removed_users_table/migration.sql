/*
  Warnings:

  - You are about to drop the `Users` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Projects" DROP CONSTRAINT "Projects_userId_fkey";

-- DropTable
DROP TABLE "Users";

-- CreateIndex
CREATE INDEX "Projects_userId_idx" ON "Projects"("userId");

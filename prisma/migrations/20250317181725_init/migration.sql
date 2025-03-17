-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('free', 'pro', 'executive');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('active', 'cancelled');

-- CreateTable
CREATE TABLE "Users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projects" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "status" "Status" NOT NULL,
    "currentPlan" "PlanType" NOT NULL,
    "cardInfo" JSONB NOT NULL,
    "apiKeyInfo" JSONB NOT NULL,
    "apiKey" TEXT NOT NULL,
    "nextPaymentDate" TIMESTAMP(3) NOT NULL,
    "currentBillingDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Images" (
    "id" TEXT NOT NULL,
    "originalImageUrl" TEXT NOT NULL,
    "results" JSONB[],
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Projects_apiKey_key" ON "Projects"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "Images_originalImageUrl_key" ON "Images"("originalImageUrl");

-- AddForeignKey
ALTER TABLE "Projects" ADD CONSTRAINT "Projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Images" ADD CONSTRAINT "Images_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

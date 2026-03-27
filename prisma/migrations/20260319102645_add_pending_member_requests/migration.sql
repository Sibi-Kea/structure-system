-- CreateEnum
CREATE TYPE "PendingMemberRequestStatus" AS ENUM ('PENDING', 'APPROVED');

-- CreateTable
CREATE TABLE "PendingMemberRequest" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "homecellId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "dateJoined" TIMESTAMP(3) NOT NULL,
    "status" "PendingMemberRequestStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingMemberRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingMemberRequest_churchId_status_createdAt_idx" ON "PendingMemberRequest"("churchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingMemberRequest_churchId_homecellId_status_idx" ON "PendingMemberRequest"("churchId", "homecellId", "status");

-- CreateIndex
CREATE INDEX "PendingMemberRequest_requestedById_status_idx" ON "PendingMemberRequest"("requestedById", "status");

-- AddForeignKey
ALTER TABLE "PendingMemberRequest" ADD CONSTRAINT "PendingMemberRequest_churchId_fkey" FOREIGN KEY ("churchId") REFERENCES "Church"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingMemberRequest" ADD CONSTRAINT "PendingMemberRequest_homecellId_fkey" FOREIGN KEY ("homecellId") REFERENCES "Homecell"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingMemberRequest" ADD CONSTRAINT "PendingMemberRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingMemberRequest" ADD CONSTRAINT "PendingMemberRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

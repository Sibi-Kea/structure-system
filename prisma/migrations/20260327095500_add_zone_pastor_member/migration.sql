-- Add pastor member assignment per zone
ALTER TABLE "Zone"
ADD COLUMN "pastorMemberId" TEXT;

CREATE INDEX "Zone_pastorMemberId_idx" ON "Zone"("pastorMemberId");

ALTER TABLE "Zone"
ADD CONSTRAINT "Zone_pastorMemberId_fkey"
FOREIGN KEY ("pastorMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

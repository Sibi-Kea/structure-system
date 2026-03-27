ALTER TABLE "HomecellReportItem"
ALTER COLUMN "homecellPresent" DROP NOT NULL,
ALTER COLUMN "homecellPresent" DROP DEFAULT,
ALTER COLUMN "churchMorningPresent" DROP NOT NULL,
ALTER COLUMN "churchMorningPresent" DROP DEFAULT,
ALTER COLUMN "churchEveningPresent" DROP NOT NULL,
ALTER COLUMN "churchEveningPresent" DROP DEFAULT;

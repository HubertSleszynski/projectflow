-- Demo accounts expire independently of real accounts.
ALTER TABLE "User" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "demoExpiresAt" TIMESTAMP(3);
CREATE INDEX "User_isDemo_demoExpiresAt_idx" ON "User"("isDemo", "demoExpiresAt");

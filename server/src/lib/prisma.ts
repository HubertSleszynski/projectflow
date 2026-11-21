import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// One Prisma client for this long-running Express process.
export const prisma = new PrismaClient({ log: ["error"] });

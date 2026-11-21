import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function run() {
  await prisma.$queryRaw`SELECT 1`;
  const [projects, tasks, members] = await Promise.all([
    prisma.project.count(), prisma.task.count(), prisma.workspaceMember.count(),
  ]);
  console.log(`PostgreSQL connected ✅ | projects: ${projects} | tasks: ${tasks} | workspace members: ${members}`);
  console.log("Database schema is reachable. Sample data is optional.");
}
run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });

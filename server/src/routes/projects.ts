import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { sampleProjects, makeTasks } from "../lib/demo-data.js";
import { Router } from "express";
import { getAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { projectFields, projectUpdate } from "../lib/validation.js";
import { tasksRouter } from "./tasks.js";

export const projectsRouter = Router();
projectsRouter.use("/:projectId/tasks", tasksRouter);

const taskOverviewSelect = {
  status: true,
  dueDate: true,
} as const;

const projectQuery = {
  _count: { select: { tasks: true } },
  tasks: { select: taskOverviewSelect },
} as const;

function formatProject<P extends { tasks: { status: string; dueDate: Date | null }[]; _count: { tasks: number } }>(project: P) {
  const { tasks, _count, ...rest } = project;
  const now = Date.now();
  return {
    ...rest,
    taskCount: _count.tasks,
    completedTaskCount: tasks.filter((task) => task.status === "DONE").length,
    overdueTaskCount: tasks.filter((task) => task.status !== "DONE" && task.dueDate !== null && task.dueDate.getTime() < now).length,
  };
}

// All project operations are scoped to the workspace from the server-side session.
projectsRouter.get("/", async (_request, response, next) => {
  try {
    const { workspaceId } = getAuth(response);
    const projects = await prisma.project.findMany({
      where: { workspaceId },
      include: projectQuery,
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    response.json({ status: "ok", projects: projects.map(formatProject) });
  } catch (error) { next(error); }
});

projectsRouter.post("/", async (request, response, next) => {
  const parsed = projectFields.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid project data" });
    return;
  }
  try {
    const { workspaceId, isDemo } = getAuth(response);
    const maxProjects = isDemo ? 6 : 50;
    if (await prisma.project.count({ where: { workspaceId } }) >= maxProjects) {
      response.status(409).json({ status: "error", message: `Workspace project limit reached (${maxProjects})` });
      return;
    }
    const project = await prisma.project.create({
      data: {
        workspaceId,
        key: `PF-${randomUUID().slice(0, 8).toUpperCase()}`,
        name: parsed.data.name,
        description: parsed.data.description || null,
      },
    });
    response.status(201).json({ status: "ok", project });
  } catch (error) { next(error); }
});

/**
 * Optional sample project for owners/admins. Existing sample projects are reused,
 * not duplicated. Earlier technical/website templates are upgraded in place,
 * preserving user-created tasks and any edited task content.
 */
const SAMPLE_KEY = sampleProjects[0].key;
const LEGACY_SAMPLE_KEY = "PF-DEMO";
const previousSampleDescriptions = new Set([
  "Refresh the company website, improve navigation and prepare the next launch.",
  "Explore a realistic sprint: priorities, due dates, progress and drag-and-drop tasks.",
]);
const previousSampleNames = new Set(["Website redesign", "Product Launch / Demo Board"]);

// Only replace known, untouched seed text. User-edited titles/descriptions are preserved.
const previousSeedTasks: Array<{ title: string; description: string; index: number }> = [
  { title: "Review homepage wireframes", description: "Share the latest layouts with stakeholders and collect final feedback.", index: 0 },
  { title: "Prepare updated brand assets", description: "Export approved logos, icons and image treatments for the marketing team.", index: 1 },
  { title: "Finalize mobile navigation", description: "Resolve interaction details for smaller screens and hand off the specification.", index: 2 },
  { title: "Build the pricing page", description: "Complete page layout and review content with the growth team.", index: 3 },
  { title: "Review accessibility findings", description: "Check keyboard navigation, contrast and form labels before release.", index: 4 },
  { title: "Approve new page copy", description: "Confirm the final messaging for the main product pages.", index: 5 },
  { title: "Complete content inventory", description: "Identify pages to update, merge or remove from the current website.", index: 6 },
  { title: "Review the onboarding experience", description: "Walk through the signup and first-project experience.", index: 0 },
  { title: "Draft release notes", description: "Summarize what changed for the team.", index: 1 },
  { title: "Implement workspace notifications", description: "Design in-app updates for project activity.", index: 2 },
  { title: "Polish responsive Kanban", description: "Improve touch interactions on narrow screens.", index: 3 },
  { title: "Review dashboard metrics", description: "Validate project progress and overdue counters.", index: 4 },
  { title: "Create project API endpoints", description: "Add validation and per-workspace access checks.", index: 5 },
  { title: "Set up PostgreSQL and Prisma", description: "Run migrations and prepare persistent data.", index: 6 },
];

projectsRouter.post("/sample", async (_request, response, next) => {
  const { workspaceId, role } = getAuth(response);
  if (role === "MEMBER") {
    response.status(403).json({ status: "error", message: "Only owners and admins can add the sample board" });
    return;
  }
  const findExisting = async () => {
    const current = await prisma.project.findUnique({ where: { workspaceId_key: { workspaceId, key: SAMPLE_KEY } } });
    return current ?? prisma.project.findUnique({ where: { workspaceId_key: { workspaceId, key: LEGACY_SAMPLE_KEY } } });
  };
  try {
    const existing = await findExisting();
    if (existing) {
      if (existing.key === LEGACY_SAMPLE_KEY) {
        const template = sampleProjects[0];
        await prisma.$transaction(async (tx) => {
          const tasks = await tx.task.findMany({
            where: { projectId: existing.id },
            select: { id: true, code: true, title: true, description: true },
          });
          for (const task of tasks) {
            const oldSeed = previousSeedTasks.find((seed) => seed.title === task.title && seed.description === task.description);
            if (!oldSeed) continue;
            const replacement = template.tasks[oldSeed.index];
            await tx.task.update({ where: { id: task.id }, data: {
              title: replacement.title,
              description: replacement.description,
              ...(task.code.startsWith("WEB-") || task.code.startsWith("PF-D")
                ? { code: `${SAMPLE_KEY}-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}` }
                : {}),
            } });
          }
          await tx.project.update({ where: { id: existing.id }, data: {
            key: SAMPLE_KEY,
            ...(previousSampleNames.has(existing.name) ? { name: template.name } : {}),
            ...(existing.description !== null && previousSampleDescriptions.has(existing.description)
              ? { description: template.description } : {}),
          } });
        });
      }
      const project = await findExisting();
      response.json({ status: "ok", created: false, project: { id: existing.id, key: project?.key ?? existing.key } });
      return;
    }
    const template = sampleProjects[0];
    const project = await prisma.project.create({ data: {
      workspaceId, key: SAMPLE_KEY, name: template.name,
      description: template.description,
      tasks: { create: makeTasks(template) },
    } });
    response.status(201).json({ status: "ok", created: true, project: { id: project.id, key: project.key } });
  } catch (error) {
    // Two nearly simultaneous requests may race on the workspace-scoped unique key.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await findExisting();
      if (existing) {
        response.json({ status: "ok", created: false, project: { id: existing.id, key: existing.key } });
        return;
      }
    }
    next(error);
  }
});

// Project details include a preview; full task CRUD is in the nested tasks router.
projectsRouter.get("/:id", async (request, response, next) => {
  try {
    const { workspaceId } = getAuth(response);
    const project = await prisma.project.findFirst({
      where: { id: String(request.params.id), workspaceId },
      include: {
        tasks: {
          select: { id: true, code: true, title: true, status: true, priority: true, dueDate: true, updatedAt: true },
          orderBy: [{ position: "asc" }, { createdAt: "asc" }],
          take: 50,
        },
        _count: { select: { tasks: true } },
      },
    });
    if (!project) {
      response.status(404).json({ status: "error", message: "Project not found" });
      return;
    }
    const { _count, ...rest } = project;
    response.json({ status: "ok", project: { ...rest, taskCount: _count.tasks } });
  } catch (error) { next(error); }
});

projectsRouter.patch("/:id", async (request, response, next) => {
  const parsed = projectUpdate.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid project data" });
    return;
  }
  try {
    const { workspaceId } = getAuth(response);
    const data = {
      ...parsed.data,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description || null } : {}),
    };
    // updateMany ensures the workspace filter is enforced by the write itself.
    const updated = await prisma.project.updateMany({ where: { id: String(request.params.id), workspaceId }, data });
    if (updated.count === 0) {
      response.status(404).json({ status: "error", message: "Project not found" });
      return;
    }
    const project = await prisma.project.findFirstOrThrow({ where: { id: String(request.params.id), workspaceId } });
    response.json({ status: "ok", project });
  } catch (error) { next(error); }
});

projectsRouter.delete("/:id", async (request, response, next) => {
  try {
    const { workspaceId, role } = getAuth(response);
    if (role !== "OWNER" && role !== "ADMIN") {
      response.status(403).json({ status: "error", message: "Only workspace owners and admins can delete projects" });
      return;
    }
    // Prisma cascading deletion also deletes project tasks; this action is permanent.
    const deleted = await prisma.project.deleteMany({ where: { id: String(request.params.id), workspaceId } });
    if (deleted.count === 0) {
      response.status(404).json({ status: "error", message: "Project not found" });
      return;
    }
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});

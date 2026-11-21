import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import { getAuth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import { taskCreate, taskReorder, taskUpdate, taskStatuses } from "../lib/task-validation.js";

// Mounted at /api/projects/:projectId/tasks. Every route is already protected by requireAuth.
export const tasksRouter = Router({ mergeParams: true });
export const myTasksRouter = Router();

// The projectId param is inherited from the parent router via mergeParams: true.
// Express cannot infer inherited route params automatically, so declare them explicitly.
type ProjectRouteParams = { projectId: string };
type TaskRouteParams = ProjectRouteParams & { taskId: string };

const taskInclude = { assignee: { select: { id: true, name: true } } } as const;

async function findWorkspaceProject(projectId: string, response: Response) {
  const { workspaceId } = getAuth(response);
  return prisma.project.findFirst({
    where: { id: projectId, workspaceId },
    select: { id: true, status: true },
  });
}

async function verifyAssignee(assigneeId: string | null | undefined, response: Response) {
  if (!assigneeId) return true;
  const { workspaceId } = getAuth(response);
  return (await prisma.workspaceMember.count({ where: { userId: assigneeId, workspaceId } })) > 0;
}

const validateWritable = (project: { status: string } | null, response: Response): boolean => {
  if (!project) {
    response.status(404).json({ status: "error", message: "Project not found" });
    return false;
  }
  if (project.status === "ARCHIVED") {
    response.status(409).json({ status: "error", message: "Restore the archived project before changing its tasks" });
    return false;
  }
  return true;
};

const order = [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }] as const;

// Return all tasks of a project, never from another workspace.
tasksRouter.get<"/", ProjectRouteParams>("/", async (request, response, next) => {
  try {
    const projectId = String(request.params.projectId);
    if (!await findWorkspaceProject(projectId, response)) {
      response.status(404).json({ status: "error", message: "Project not found" });
      return;
    }
    const tasks = await prisma.task.findMany({ where: { projectId }, include: taskInclude,
      orderBy: [{ status: "asc" }, { position: "asc" }, { createdAt: "asc" }], take: 500 });
    response.json({ status: "ok", tasks });
  } catch (error) { next(error); }
});

tasksRouter.post<"/", ProjectRouteParams>("/", async (request, response, next) => {
  const parsed = taskCreate.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid task" });
    return;
  }
  try {
    const projectId = String(request.params.projectId);
    if (!validateWritable(await findWorkspaceProject(projectId, response), response)) return;
    if (!await verifyAssignee(parsed.data.assigneeId, response)) {
      response.status(400).json({ status: "error", message: "Assignee is not a workspace member" });
      return;
    }
    const maxTasks = getAuth(response).isDemo ? 60 : 500;
    if (await prisma.task.count({ where: { projectId } }) >= maxTasks) {
      response.status(409).json({ status: "error", message: `Project task limit reached (${maxTasks})` });
      return;
    }
    const status = parsed.data.status ?? "TODO";
    const last = await prisma.task.aggregate({ where: { projectId, status }, _max: { position: true } });
    const task = await prisma.task.create({
      data: {
        projectId, code: `PF-T${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
        title: parsed.data.title, description: parsed.data.description || null,
        status, priority: parsed.data.priority ?? "MEDIUM", position: (last._max.position ?? -1) + 1,
        dueDate: parsed.data.dueDate ? new Date(`${parsed.data.dueDate}T00:00:00.000Z`) : null,
        assigneeId: parsed.data.assigneeId ?? null,
      }, include: taskInclude,
    });
    response.status(201).json({ status: "ok", task });
  } catch (error) { next(error); }
});

// Reorder uses an atomic transaction so task positions stay consistent when moving cards.
tasksRouter.post<"/reorder", ProjectRouteParams>("/reorder", async (request, response, next) => {
  const parsed = taskReorder.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid move" });
    return;
  }
  try {
    const projectId = String(request.params.projectId);
    if (!validateWritable(await findWorkspaceProject(projectId, response), response)) return;
    const tasks = await prisma.task.findMany({ where: { projectId }, select: { id: true, status: true, position: true },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    const moving = tasks.find((task) => task.id === parsed.data.taskId);
    if (!moving) { response.status(404).json({ status: "error", message: "Task not found" }); return; }
    if (moving.id === parsed.data.beforeTaskId) { response.json({ status: "ok" }); return; }
    const destination = tasks.filter((task) => task.id !== moving.id && task.status === parsed.data.status);
    const beforeIndex = parsed.data.beforeTaskId === null ? destination.length : destination.findIndex((task) => task.id === parsed.data.beforeTaskId);
    if (beforeIndex < 0) {
      response.status(400).json({ status: "error", message: "Drop target is not in the destination column" });
      return;
    }
    destination.splice(beforeIndex, 0, { ...moving, status: parsed.data.status });
    const source = moving.status === parsed.data.status ? [] : tasks.filter((task) => task.id !== moving.id && task.status === moving.status);
    await prisma.$transaction([...source.map((task, index) => prisma.task.update({ where: { id: task.id }, data: { position: index } })),
      ...destination.map((task, index) => prisma.task.update({ where: { id: task.id }, data: { position: index, status: parsed.data.status } }))]);
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});

tasksRouter.patch<"/:taskId", TaskRouteParams>("/:taskId", async (request, response, next) => {
  const parsed = taskUpdate.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ status: "error", message: parsed.error.issues[0]?.message ?? "Invalid update" });
    return;
  }
  try {
    const projectId = String(request.params.projectId);
    if (!validateWritable(await findWorkspaceProject(projectId, response), response)) return;
    const taskId = String(request.params.taskId);
    const current = await prisma.task.findFirst({ where: { id: taskId, projectId } });
    if (!current) { response.status(404).json({ status: "error", message: "Task not found" }); return; }
    if (!await verifyAssignee(parsed.data.assigneeId, response)) {
      response.status(400).json({ status: "error", message: "Assignee is not a workspace member" }); return;
    }
    const { dueDate, description, status, ...rest } = parsed.data;
    const data = {
      ...rest,
      ...(description !== undefined ? { description: description || null } : {}),
      ...(dueDate !== undefined ? { dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null } : {}),
      ...(status !== undefined ? { status } : {}),
    };
    if (status && status !== current.status) {
      const last = await prisma.task.aggregate({ where: { projectId, status }, _max: { position: true } });
      Object.assign(data, { position: (last._max.position ?? -1) + 1 });
    }
    await prisma.task.updateMany({ where: { id: taskId, projectId }, data });
    const task = await prisma.task.findFirstOrThrow({ where: { id: taskId, projectId }, include: taskInclude });
    response.json({ status: "ok", task });
  } catch (error) { next(error); }
});

tasksRouter.delete<"/:taskId", TaskRouteParams>("/:taskId", async (request, response, next) => {
  try {
    const projectId = String(request.params.projectId);
    if (!validateWritable(await findWorkspaceProject(projectId, response), response)) return;
    const removed = await prisma.task.deleteMany({ where: { id: String(request.params.taskId), projectId } });
    if (removed.count === 0) { response.status(404).json({ status: "error", message: "Task not found" }); return; }
    response.json({ status: "ok" });
  } catch (error) { next(error); }
});

// 'My tasks' only shows tasks explicitly assigned to the logged-in user.
myTasksRouter.get("/mine", async (_request, response, next) => {
  try {
    const { userId, workspaceId } = getAuth(response);
    const tasks = await prisma.task.findMany({
      where: { assigneeId: userId, project: { workspaceId, status: { not: "ARCHIVED" } } },
      include: { project: { select: { id: true, key: true, name: true } } },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }], take: 200,
    });
    response.json({ status: "ok", tasks });
  } catch (error) { next(error); }
});

import { z } from "zod";

export const taskStatuses = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
export const taskPriorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, "Enter a valid calendar date");

export const taskCreate = z.object({
  title: z.string().trim().min(3, "Task title must have at least 3 characters").max(120),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(taskStatuses).optional(),
  priority: z.enum(taskPriorities).optional(),
  dueDate: dateField.nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
}).strict();

export const taskUpdate = taskCreate.partial()
  .refine((body) => Object.keys(body).length > 0, "Provide a field to change");

export const taskReorder = z.object({
  taskId: z.string().min(1),
  status: z.enum(taskStatuses),
  beforeTaskId: z.string().min(1).nullable(),
}).strict();

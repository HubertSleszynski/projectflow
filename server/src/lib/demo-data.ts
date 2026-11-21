import { randomUUID } from "node:crypto";
import type { Prisma, ProjectStatus, TaskPriority, TaskStatus } from "@prisma/client";

type WorkItem = {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueInDays: number;
};
type SampleProject = {
  key: string;
  name: string;
  description: string;
  status: ProjectStatus;
  tasks: WorkItem[];
};

// Realistic fictional event-management work, unrelated to the implementation of ProjectFlow.
// The first project also powers the optional "Add sample project" action.
export const sampleProjects: SampleProject[] = [
  {
    key: "EVT", name: "City Food Festival", status: "ACTIVE",
    description: "Coordinate vendors, logistics and promotion for a weekend food festival.",
    tasks: [
      { title: "Confirm venue booking", description: "Finalize the location agreement and access times with the venue team.", status: "TODO", priority: "HIGH", dueInDays: 4 },
      { title: "Coordinate food vendors", description: "Collect final menus, power requirements and arrival details from participating vendors.", status: "TODO", priority: "MEDIUM", dueInDays: 8 },
      { title: "Finalize event schedule", description: "Lock the program, setup windows and handover times for each area.", status: "IN_PROGRESS", priority: "URGENT", dueInDays: 2 },
      { title: "Arrange signage and wayfinding", description: "Confirm the layout, print quantities and installation plan for visitor signage.", status: "IN_PROGRESS", priority: "HIGH", dueInDays: 6 },
      { title: "Review event safety plan", description: "Check first-aid coverage, emergency exits and wet-weather contingencies.", status: "IN_REVIEW", priority: "HIGH", dueInDays: 3 },
      { title: "Approve promotional materials", description: "Sign off the final posters, social posts and press announcement.", status: "DONE", priority: "MEDIUM", dueInDays: -3 },
      { title: "Complete equipment inventory", description: "Verify the tables, barriers, lighting and supplies available for event day.", status: "DONE", priority: "LOW", dueInDays: -6 },
    ],
  },
  {
    key: "MKT", name: "Riverside Market", status: "ACTIVE",
    description: "Prepare the seasonal outdoor market with local makers and food stalls.",
    tasks: [
      { title: "Confirm stall layout", description: "Approve the final site map and vendor locations.", status: "DONE", priority: "HIGH", dueInDays: -4 },
      { title: "Review vendor applications", description: "Complete the shortlist and notify participating businesses.", status: "IN_REVIEW", priority: "MEDIUM", dueInDays: 5 },
      { title: "Book delivery vehicles", description: "Arrange equipment transport and delivery slots for setup day.", status: "IN_PROGRESS", priority: "HIGH", dueInDays: 7 },
      { title: "Prepare visitor information", description: "Write directions, opening hours and accessibility information for guests.", status: "TODO", priority: "MEDIUM", dueInDays: 11 },
    ],
  },
  {
    key: "FND", name: "Community Fundraiser", status: "ON_HOLD",
    description: "Bring local partners together for an upcoming charity evening.",
    tasks: [
      { title: "Draft sponsor outreach plan", description: "Prepare the partner list and sponsorship packages for review.", status: "IN_REVIEW", priority: "MEDIUM", dueInDays: 9 },
      { title: "Confirm donation collection process", description: "Coordinate payment collection and receipts with the charity team.", status: "TODO", priority: "LOW", dueInDays: 14 },
      { title: "Set fundraising target", description: "Agree on the campaign goal and how progress will be reported.", status: "DONE", priority: "HIGH", dueInDays: -2 },
    ],
  },
];

function dueDate(days: number): Date {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 12));
}

export function makeTasks(project: SampleProject, assigneeId?: string): Prisma.TaskCreateWithoutProjectInput[] {
  const lanePosition: Record<TaskStatus, number> = { TODO: 0, IN_PROGRESS: 0, IN_REVIEW: 0, DONE: 0 };
  return project.tasks.map((task) => ({
    code: `${project.key}-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: dueDate(task.dueInDays),
    position: lanePosition[task.status]++,
    ...(assigneeId ? { assignee: { connect: { id: assigneeId } } } : {}),
  }));
}

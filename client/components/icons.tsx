import type { ReactNode } from "react";

type IconName =
  | "grid"
  | "layers"
  | "folder"
  | "checklist"
  | "users"
  | "activity"
  | "arrow-up-right"
  | "refresh"
  | "check"
  | "shield"
  | "chevron-right";

const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.3" /><rect x="14" y="3" width="7" height="7" rx="1.3" /><rect x="3" y="14" width="7" height="7" rx="1.3" /><rect x="14" y="14" width="7" height="7" rx="1.3" /></>,
  layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
  folder: <path d="M3 7.5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
  checklist: <><path d="m4 6 2 2 3-3M12 7h8M4 17l2 2 3-3M12 18h8"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4"/>,
  "arrow-up-right": <><path d="M7 17 17 7M8 7h9v9"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.6-4.4L3 9m0-6v6h6M4 13a8 8 0 0 0 14.6 4.4L21 15m0 6v-6h-6"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  shield: <><path d="m12 22 0 0C5 18 4 14 4 8V5l8-3 8 3v3c0 6-1 10-8 14Z"/><path d="m9 12 2 2 4-4"/></>,
  "chevron-right": <path d="m9 18 6-6-6-6"/>,
};

export function Icon({ name, size = 18, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

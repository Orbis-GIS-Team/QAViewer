import type { NextFunction, Request, Response } from "express";

export const ROLES = ["admin", "gis_team", "land_records_team", "client", "other"] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "question_areas:read",
  "question_areas:review",
  "question_areas:assign",
  "question_areas:comment",
  "question_areas:upload_document",
  "atlas_land_records:read",
  "property_tax:read",
  "admin:manage_users",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: [
    "question_areas:read",
    "question_areas:review",
    "question_areas:assign",
    "question_areas:comment",
    "question_areas:upload_document",
    "atlas_land_records:read",
    "property_tax:read",
    "admin:manage_users",
  ],
  gis_team: [
    "question_areas:read",
    "question_areas:review",
    "question_areas:comment",
    "question_areas:upload_document",
    "atlas_land_records:read",
    "property_tax:read",
  ],
  land_records_team: [
    "question_areas:read",
    "question_areas:review",
    "question_areas:comment",
    "question_areas:upload_document",
    "atlas_land_records:read",
    "property_tax:read",
  ],
  client: ["question_areas:read"],
  other: [],
};

export function hasPermission(
  user: { role: Role } | null | undefined,
  permission: Permission,
): boolean {
  return Boolean(user && (ROLE_PERMISSIONS[user.role] ?? []).includes(permission));
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: "Not authenticated." });
      return;
    }

    if (!hasPermission(user, permission)) {
      res.status(403).json({ message: "Insufficient permissions." });
      return;
    }

    next();
  };
}

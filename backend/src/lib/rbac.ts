import type { NextFunction, Request, Response } from "express";

export const ROLES = ["admin", "gis_team", "land_records_team", "client", "other"] as const;

export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  "atlas_land_records:read",
  "property_tax:read",
  "admin:manage_users",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: ["atlas_land_records:read", "property_tax:read", "admin:manage_users"],
  gis_team: ["atlas_land_records:read", "property_tax:read"],
  land_records_team: ["atlas_land_records:read", "property_tax:read"],
  client: [],
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

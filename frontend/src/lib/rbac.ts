export const ROLES = ["admin", "gis_team", "land_records_team", "client", "other"] as const;

export type UserRole = (typeof ROLES)[number];

export const PERMISSIONS = [
  "atlas_land_records:read",
  "property_tax:read",
  "admin:manage_users",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type SupportWorkspaceTab = "atlas" | "tax-parcels";

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  admin: ["atlas_land_records:read", "property_tax:read", "admin:manage_users"],
  gis_team: ["atlas_land_records:read", "property_tax:read"],
  land_records_team: ["atlas_land_records:read", "property_tax:read"],
  client: [],
  other: [],
};

export const SUPPORT_TABS: Array<{
  id: SupportWorkspaceTab;
  label: string;
  permission: Permission;
}> = [
  { id: "atlas", label: "Atlas", permission: "atlas_land_records:read" },
  { id: "tax-parcels", label: "Tax Parcels", permission: "property_tax:read" },
];

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function getVisibleSupportTabs(role: UserRole) {
  return SUPPORT_TABS.filter((tab) => hasPermission(role, tab.permission));
}

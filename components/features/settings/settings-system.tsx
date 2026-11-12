"use client";

import { AdminControlCenter } from "@/components/features/admin/control-center/admin-control-center";

/**
 * Settings › Administration: the instance at a glance, the same control center as Admin's first
 * page, here where the instance's other settings are. It was a box of three links to those pages,
 * one more step to see whether anything was wrong. Its panels link on to Admin's Status and Access
 * pages for the detail, and Admin keeps its pages, since they are opened when the app itself is
 * broken and read nothing the app loads.
 *
 * Settings lists this section only for an administrator, and the admin APIs refuse anyone else
 * whatever reaches the component.
 */
export function SettingsSystem() {
  return <AdminControlCenter />;
}

export default SettingsSystem;

import { api, ApiEnvelope, PaginationMeta } from "./axios";

/** Mirrors the backend RBAC + audit API shapes (Module 03). */

export interface Role {
  id: string;
  schoolId: string;
  name: string;
  slug: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RoleWithStats extends Role {
  permissionCount: number;
  userCount: number;
}

export interface RoleDetail extends Role {
  permissionCodes: string[];
  /** System-role core codes — rendered as checked + non-removable. */
  lockedCodes: string[];
}

export interface Permission {
  id: string;
  code: string;
  module: string;
  description: string | null;
  isOrphaned: boolean;
}

export interface AuditLogEntry {
  id: string;
  schoolId: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
}

export interface AuditLogQuery extends ListQuery {
  userId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Strip undefined/empty params so URLs stay clean. */
const params = (query: object) =>
  Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== ""),
  );

export const rbacApi = {
  async listRoles(
    query: ListQuery,
  ): Promise<{ data: RoleWithStats[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<RoleWithStats[]>>("/roles", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },

  async getRole(id: string): Promise<RoleDetail> {
    const res = await api.get<ApiEnvelope<RoleDetail>>(`/roles/${id}`);
    return res.data.data;
  },

  async createRole(input: {
    name: string;
    slug: string;
    description?: string;
  }): Promise<Role> {
    const res = await api.post<ApiEnvelope<Role>>("/roles", input);
    return res.data.data;
  },

  async updateRole(
    id: string,
    input: { name?: string; description?: string; expectedUpdatedAt?: string },
  ): Promise<Role> {
    const res = await api.put<ApiEnvelope<Role>>(`/roles/${id}`, input);
    return res.data.data;
  },

  async deleteRole(id: string): Promise<void> {
    await api.delete(`/roles/${id}`);
  },

  async setRolePermissions(
    id: string,
    input: { permissionCodes: string[]; expectedUpdatedAt?: string },
  ): Promise<RoleDetail> {
    const res = await api.put<ApiEnvelope<RoleDetail>>(
      `/roles/${id}/permissions`,
      input,
    );
    return res.data.data;
  },

  async listPermissions(): Promise<Permission[]> {
    const res = await api.get<ApiEnvelope<Permission[]>>("/permissions");
    return res.data.data;
  },

  async getUserRoles(userId: string): Promise<Role[]> {
    const res = await api.get<ApiEnvelope<Role[]>>(`/users/${userId}/roles`);
    return res.data.data;
  },

  async setUserRoles(userId: string, roleIds: string[]): Promise<Role[]> {
    const res = await api.put<ApiEnvelope<Role[]>>(`/users/${userId}/roles`, {
      roleIds,
    });
    return res.data.data;
  },

  async listAuditLogs(
    query: AuditLogQuery,
  ): Promise<{ data: AuditLogEntry[]; meta: PaginationMeta }> {
    const res = await api.get<ApiEnvelope<AuditLogEntry[]>>("/audit-logs", {
      params: params(query),
    });
    return { data: res.data.data, meta: res.data.meta! };
  },
};

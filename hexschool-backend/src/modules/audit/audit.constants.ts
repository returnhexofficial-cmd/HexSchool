/**
 * Audit action verbs. Stored as VARCHAR (not a PG enum) so later modules
 * can add verbs (EXPORT, APPROVE, PUBLISH, …) without an enum migration;
 * this list is the canonical set so far.
 */
export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'EXPORT',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number] | (string & {});

/** Default action per HTTP method when neither @Audit nor the service hook sets one. */
export const METHOD_ACTION_MAP: Record<string, AuditAction> = {
  POST: 'CREATE',
  PUT: 'UPDATE',
  PATCH: 'UPDATE',
  DELETE: 'DELETE',
};

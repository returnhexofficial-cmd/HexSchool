import { z } from "zod";

/** Mirrors backend CreateRoleDto/UpdateRoleDto (roadmap M03 §7). */

export const roleSlugPattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export const createRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(64, "Name must be at most 64 characters"),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters")
    .max(64, "Slug must be at most 64 characters")
    .regex(roleSlugPattern, 'Slug must be kebab-case, e.g. "exam-controller"'),
  description: z
    .string()
    .trim()
    .max(500, "Description must be at most 500 characters")
    .optional()
    .or(z.literal("")),
});

export const updateRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(64, "Name must be at most 64 characters"),
  description: z
    .string()
    .trim()
    .max(500, "Description must be at most 500 characters")
    .optional()
    .or(z.literal("")),
});

export type CreateRoleValues = z.infer<typeof createRoleSchema>;
export type UpdateRoleValues = z.infer<typeof updateRoleSchema>;

/**
 * The largest `limit` any list endpoint accepts.
 *
 * Mirrors `MAX_PAGE_LIMIT` in the backend's `common/dto/pagination-query.dto.ts`,
 * where it is enforced with `@Max()`. Asking for more is not clamped — it is a
 * **400**, and a picker that asks for more simply never populates.
 *
 * That is QA finding **F31**: fourteen call sites asked for 200 or 300, so the
 * routine builder's "combined with" picker, the promotion wizard's target
 * sections, and the assignment, inventory, library and alumni pickers were all
 * permanently empty — each failing silently, because a rejected query renders
 * as an empty select rather than an error.
 *
 * **This is a ceiling, not a page size.** A school with more than 100 sections
 * or alumni still needs a searchable or paginated picker; capping here turns a
 * broken control into a truncated one, which is better but not finished. See
 * `PROJECT_CONTEXT.md` §18.
 */
export const MAX_PAGE_LIMIT = 100;

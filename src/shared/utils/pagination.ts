import { z } from "zod";

export interface PageParams {
  page: number;
  limit: number;
}

export interface PaginationMetadata {
  current_page: number;
  limit: number;
  has_next_page: boolean;
}

/** `page` and `limit` query fields. Spread into a z.object(). */
export function paginationShape(defaultLimit = 20, maxLimit = 100) {
  return {
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(maxLimit).default(defaultLimit),
  };
}

export const pageOffset = ({ page, limit }: PageParams): number =>
  (page - 1) * limit;

/** Metadata when the total row count is known. */
export function paginationMetadata(
  page: number,
  limit: number,
  total: number,
): PaginationMetadata {
  return { current_page: page, limit, has_next_page: page * limit < total };
}

/**
 * For queries that fetch `limit + 1` rows instead of counting: the extra row
 * only says there is a next page, so it is dropped from the result.
 */
export function pageFromExtraRow<T>(
  rows: T[],
  { page, limit }: PageParams,
): { rows: T[]; metadata: PaginationMetadata } {
  const hasNext = rows.length > limit;
  return {
    rows: hasNext ? rows.slice(0, limit) : rows,
    metadata: { current_page: page, limit, has_next_page: hasNext },
  };
}

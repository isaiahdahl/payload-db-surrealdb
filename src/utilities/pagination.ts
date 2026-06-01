export type PaginationInfo = {
  currentPage: number
  limit: number
  start: number
}

export const getPagination = (args: Record<string, any>): PaginationInfo => {
  const limit = Number(args.limit ?? 0)
  const page = Number(args.page ?? 1)
  const start = Number(args.skip ?? Math.max(page - 1, 0) * (limit > 0 ? limit : 0))
  const currentPage = args.skip !== undefined && limit > 0 ? Math.floor(start / limit) + 1 : page

  return { currentPage, limit, start }
}

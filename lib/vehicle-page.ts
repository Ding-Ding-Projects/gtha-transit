export function vehiclePage<T>(items: T[], requestedPage: number) {
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.max(
    0,
    Math.min(pageCount - 1, Math.trunc(requestedPage) || 0),
  );
  const start = page * pageSize;
  return {
    page,
    pageCount,
    start,
    end: Math.min(start + pageSize, items.length),
    items: items.slice(start, start + pageSize),
  };
}

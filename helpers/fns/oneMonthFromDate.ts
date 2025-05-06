export function getOneMonthFromDate(date: string | Date = new Date()) {
  const now = new Date(date);
  now.setMonth(now.getMonth() + 1);
  return now.getTime();
}

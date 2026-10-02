/** The Cairo calendar day of `date` as YYYY-MM-DD (the platform's day, whatever the server's zone). */
export function cairoDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

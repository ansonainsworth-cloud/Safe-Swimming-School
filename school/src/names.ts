/** Keep child records to a single first name. */
export function firstNameOnly(value: string): string {
  const token = value.trim().split(/\s+/)[0] ?? "";
  const letters = token.replace(/[^A-Za-z]/g, "");
  if (!letters) return "";
  return letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
}

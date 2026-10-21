export function cn(...parties: Array<string | false | null | undefined>): string {
  return parties.filter(Boolean).join(' ')
}

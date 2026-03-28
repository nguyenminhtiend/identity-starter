export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const pgCode = (error as { code?: string }).code;
  if (pgCode === '23505') {
    return true;
  }
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code === '23505';
}

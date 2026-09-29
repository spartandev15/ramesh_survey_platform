/** Checks shared by the sign-in forms. The server checks everything again. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailError(email: string): string | undefined {
  return EMAIL_RE.test(email) ? undefined : "Enter a valid email address";
}

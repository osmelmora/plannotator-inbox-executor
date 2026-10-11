export function authenticate(token: string) {
  if (!token.trim()) throw new Error("Empty token");
  return token;
}

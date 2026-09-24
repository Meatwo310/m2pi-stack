export function allowAllUsers(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("DISCORD_ALLOW_ALL_USERS は true / false のいずれかです");
}

export function canUseBot(userId: string, allowAll: boolean, allowedUsers: ReadonlySet<string>): boolean {
  return allowAll || allowedUsers.has(userId);
}

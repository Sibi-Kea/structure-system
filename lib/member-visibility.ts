import { Role } from "@prisma/client";

const LIMITED_MEMBER_VIEW_ROLES = new Set<Role>([
  Role.OVERSEER,
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.HOMECELL_LEADER,
]);

export function hasLimitedMemberView(role: Role) {
  return LIMITED_MEMBER_VIEW_ROLES.has(role);
}


import type { Person } from "../../domain/model";
import { normalizeLabel } from "../../lib/normalizeLabel";

export const MAX_PEOPLE_ROLE_TABS = 6;
export type PeopleRole = { key: string; label: string; count: number };

export const roleKey = (value: string) => normalizeLabel(value);

export function peopleRoles(
  people: readonly Pick<Person, "role" | "archivedAt">[],
): PeopleRole[] {
  const roles = new Map<string, PeopleRole>();
  for (const person of people) {
    if (person.archivedAt) continue;
    const label = person.role.replace(/\s+/g, " ").trim();
    const key = roleKey(label);
    if (!key) continue;
    const existing = roles.get(key);
    if (existing) existing.count++;
    else roles.set(key, { key, label, count: 1 });
  }
  return [...roles.values()].sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, "bn"),
  );
}

export function visibleRoleTabs(
  roles: readonly PeopleRole[],
  selectedKeys: null | readonly string[],
): PeopleRole[] {
  if (selectedKeys === null) return roles.slice(0, MAX_PEOPLE_ROLE_TABS);
  const available = new Map(roles.map((role) => [role.key, role]));
  const seen = new Set<string>();
  const visible: PeopleRole[] = [];
  for (const value of selectedKeys) {
    const key = roleKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    const role = available.get(key);
    if (role) visible.push(role);
    if (visible.length === MAX_PEOPLE_ROLE_TABS) break;
  }
  return visible;
}

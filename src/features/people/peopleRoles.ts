import type { Person } from "../../domain/model";
import { normalizeLabel } from "../../lib/normalizeLabel";
import { contactPresetFor, contactPresets } from "./contactPresets";

export const MAX_PEOPLE_ROLE_TABS = 8;
export type PeopleRole = { key: string; label: string; count: number };

export const roleKey = (value: string) => normalizeLabel(value);

export function peopleRoles(
  people: readonly (Pick<
    Person,
    "role" | "kind" | "contactType" | "archivedAt"
  > &
    Partial<Pick<Person, "name">>)[],
): PeopleRole[] {
  const roles = new Map<string, PeopleRole>();
  for (const person of people) {
    if (person.archivedAt) continue;
    const preset = contactPresetFor(person);
    const key = preset.id;
    const label = key === "custom" ? "ধরন বাছা হয়নি" : preset.label;
    const existing = roles.get(key);
    if (existing) existing.count++;
    else roles.set(key, { key, label, count: 1 });
  }
  return contactPresets.flatMap((preset) => {
    const type = roles.get(preset.id);
    return type ? [type] : [];
  });
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
    const key = value;
    if (seen.has(key)) continue;
    seen.add(key);
    const role = available.get(key);
    if (role) visible.push(role);
    if (visible.length === MAX_PEOPLE_ROLE_TABS) break;
  }
  return visible;
}

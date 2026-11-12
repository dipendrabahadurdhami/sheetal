// The typed settings store: what a setting definition is (SETTINGS.md section 2.1).
// Where it fits: defs.ts declares the settings; service.ts reads and writes them; routes.ts and the admin screens list them with describe().
// Rules: a value is validated in ONE place (def.schema). A setting belongs to the platform (one value) or to a business (one value per business, falling
// back to the default). Who may read or change it is named on the definition, never decided by a caller.

import type { ZodType } from "zod";

export interface Text { en: string; ne?: string }
export type SettingScope = "platform" | "business";

export interface SettingDef<T = unknown> {
  /** "platform.revenueShare", "platform.theme", "platform.fieldDefs.business_profile", "business.profile"… */
  key: string;
  scope: SettingScope;
  schema: ZodType<T>;
  default: T;
  label: Text;
  help?: Text;
  /** Where it shows on the screens: "revenue", "theme", "fields", "profile"… */
  group: string;
  /** May be sent to the website without a sign-in. Default false. */
  public?: boolean;
  /** Platform permission to read / change (platform scope) or business permission (business scope). */
  read: string;
  write: string;
  /** The audit row lists changed field names only ("names", the default) or also the new values ("values": only for harmless ones, like colours). */
  audit?: "names" | "values";
  /** A change must carry a reason (5 to 300 characters), saved in the audit row. */
  needsReason?: boolean;
  /** Refuses a value that would break something running, with a plain sentence. Runs after the schema. */
  guard?: (next: T, prev: T) => string | null;
}

export interface SettingChange { at: Date; actorId: string | null; fields: string[]; reason: string | null }

import { randomUUID } from "node:crypto";

/** A new id for a message (also used inside its Message-ID header). */
export const createId = () => randomUUID().replace(/-/g, "");

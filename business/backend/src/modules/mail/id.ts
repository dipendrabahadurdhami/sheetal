// New ids for email messages (also used inside the Message-ID header).

import { randomUUID } from "node:crypto";

/** A new id for a message (also used inside its Message-ID header). */
export const createId = () => randomUUID().replace(/-/g, "");

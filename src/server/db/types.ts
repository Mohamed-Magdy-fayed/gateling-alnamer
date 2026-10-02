import { customType } from "drizzle-orm/pg-core";

/** Case-insensitive text (PostgreSQL citext). Values keep the case they were written with. */
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

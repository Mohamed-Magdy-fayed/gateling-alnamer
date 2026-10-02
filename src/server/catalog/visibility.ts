import { type AnyColumn, or, type SQL, sql } from "drizzle-orm";
import { platformSettings } from "@/server/db/schema";

/**
 * Sample rows show until an admin hides them: `is_sample = false OR sample_hidden_at IS NULL`.
 * Pass the `is_sample` column of the table being queried.
 */
export function sampleVisible(isSampleColumn: AnyColumn): SQL {
  const notSample = sql`${isSampleColumn} = false`;
  const stillShown = sql`(select ${platformSettings.sampleHiddenAt} from ${platformSettings} where ${platformSettings.id} = 1) is null`;
  return or(notSample, stillShown) ?? notSample;
}

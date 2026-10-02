import { serve } from "inngest/next";
import { inngest } from "@/server/jobs/client";
import { functions } from "@/server/jobs/functions";

export const { GET, POST, PUT } = serve({ client: inngest, functions });

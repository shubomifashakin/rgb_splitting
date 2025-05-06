import { z } from "zod";

import { planNameValidator } from "./planNameValidator";
import { projectIdValidator } from "./projectIdValidator";

export const webHookEventValidator = z.object({
  event: z.enum(["charge.completed"]),

  data: z.object({}).passthrough(),

  meta_data: z.object({
    userId: z.string(),
    usagePlanId: z.string(),
    projectName: z.string(),
    planName: planNameValidator,
    projectId: projectIdValidator,
  }),
});

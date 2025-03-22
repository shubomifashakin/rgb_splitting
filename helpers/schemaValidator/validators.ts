import { z } from "zod";

import { planNameValidator } from "./planNameValidator";

export const projectIdValidator = z.string().uuid();

export const newPaymentRequestBodyValidator = z.object({
  planName: planNameValidator,

  projectName: z
    .string({ message: "Project name should be a string" })
    .min(4, { message: "Project name should be at least 4 characters" })
    .transform((value) => value.toLowerCase().trim()),

  email: z.string({ message: "Invalid email" }).email(),

  userId: z.string(),

  fullName: z
    .string()
    .optional()
    .transform((value) => value?.trim()),

  projectId: projectIdValidator.optional(),
});

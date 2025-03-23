import { z } from "zod";

import { planNameValidator } from "./planNameValidator";
import { projectIdValidator } from "./projectIdValidator";

export const projectNameValidator = z
  .string({ message: "Project name should be a string" })
  .min(4, { message: "Project name should be at least 4 characters" })
  .transform((value) => value.toLowerCase().trim());

export const userIdValidator = z.string();

export const newPaymentRequestBodyValidator = z.object({
  planName: planNameValidator,

  projectName: projectNameValidator,

  email: z.string({ message: "Invalid email" }).email(),

  userId: userIdValidator,

  fullName: z
    .string()
    .optional()
    .transform((value) => value?.trim()),

  projectId: projectIdValidator.optional(),
});

import { z } from "zod";

import { planNameValidator } from "./planNameValidator";

import { PlanType } from "../constants";

export const newPaymentRequestBodyValidator = z.object({
  planName: planNameValidator,

  projectName: z
    .string({ message: "Project name should be a string" })
    .min(4, { message: "Project name should be at least 4 characters" })
    .transform((value) => value.toLowerCase().trim()),

  email: z.string({ message: "Invalid type of emailAddress" }).email(),

  userId: z.string(),

  fullName: z
    .string()
    .optional()
    .transform((value) => value?.trim()),

  projectId: z.string().uuid().optional(),
});

export const usagePlanValidator = z.object({
  [PlanType.Free]: z.string(),
  [PlanType.Pro]: z.string(),
  [PlanType.Executive]: z.string(),
});

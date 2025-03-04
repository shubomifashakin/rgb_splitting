import { z } from "zod";

export const newPaymentRequestBodyValidator = z.object({
  planName: z
    .string({ message: "Plan name should be a string" })
    .transform((value) => value.toLowerCase().trim())
    .refine((value) => ["free", "pro", "executive"].includes(value), {
      message: "Invalid plan name",
    }),

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
});

export const usagePlanValidator = z.object({
  free: z.string(),
  pro: z.string(),
  executive: z.string(),
});

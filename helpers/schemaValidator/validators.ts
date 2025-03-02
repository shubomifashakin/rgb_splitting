import { z } from "zod";

export const newPaymentRequestBodyValidator = z.object({
  planName: z
    .string({ message: "Plan name should be a string" })
    .transform((value) => value.toLowerCase())
    .refine((value) => ["free", "pro", "executive"].includes(value), {
      message: "Invalid plan name",
    }),

  projectName: z
    .string({ message: "Project name should be a string" })
    .min(4, { message: "Project name should be at least 4 characters" })
    .transform((value) => value),

  email: z.string({ message: "Invalid type of emailAddress" }).email(),

  userId: z.string(),
});

export const usagePlanValidator = z.object({
  free: z.string(),
  pro: z.string(),
  executive: z.string(),
});

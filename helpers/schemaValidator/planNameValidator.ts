import { z } from "zod";

import { PlanType } from "../constants";

export const planNameValidator = z
  .string({ message: "Plan name should be a string" })
  .transform((value) => value.toLowerCase().trim())
  .refine((value) => Object.values(PlanType).includes(value as PlanType), {
    message: "Invalid plan",
  })
  .transform((value) => value as PlanType);

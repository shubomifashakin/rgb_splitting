import { z } from "zod";

import { PlanType } from "../constants";

export const planNameValidator = z
  .string({ message: "Plan name should be a string" })
  .transform((value) => value.toLowerCase().trim() as PlanType)
  .refine((value) => Object.values(PlanType).includes(value), {
    message: "Invalid plan",
  });

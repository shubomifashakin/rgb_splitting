import { z } from "zod";
import { PlanType } from "../constants";

export const planSizesValidator = z.object({
  [PlanType.Free]: z
    .string()
    .refine((val) => !isNaN(parseInt(val)), {
      message: "Must be a number",
    })
    .transform((val) => parseInt(val)),
  [PlanType.Pro]: z
    .string()
    .refine((val) => !isNaN(parseInt(val)), {
      message: "Must be a number",
    })
    .transform((val) => parseInt(val)),
  [PlanType.Executive]: z
    .string()
    .refine((val) => !isNaN(parseInt(val)), {
      message: "Must be a number",
    })
    .transform((val) => parseInt(val)),
});

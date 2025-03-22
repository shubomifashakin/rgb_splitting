import { z } from "zod";
import { PlanType } from "../constants";

export const usagePlanValidator = z.object({
  [PlanType.Free]: z.string(),
  [PlanType.Pro]: z.string(),
  [PlanType.Executive]: z.string(),
});

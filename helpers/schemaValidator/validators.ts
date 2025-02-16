import { z } from "zod";

export const webHookValidationSchema = z.object({});

export const allUserApiKeysPathParamtersValidator = z.object({
  userId: z.string({ message: "Invalid type of userId " }),
});

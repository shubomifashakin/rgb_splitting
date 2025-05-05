import { z } from "zod";

import { grainValidator } from "./processValidator";
import { projectIdValidator } from "./projectIdValidator";
import { normalizedChannelValidator } from "./normalizedChannelsValidator";
import { userIdValidator } from "./newPaymentRequestBodyValidator";

export const s3ImageMetadataValidator = z.object({
  project_id: projectIdValidator,

  user_id: userIdValidator,

  grains: z
    .string()
    .refine(
      (value) => {
        try {
          const isParseable = JSON.parse(value);

          grainValidator.parse(isParseable);

          return true;
        } catch (e) {
          return false;
        }
      },
      {
        message: "grain is invalid",
      }
    )
    .transform((value) => {
      const parsedGrain = JSON.parse(value);

      return parsedGrain as typeof grainValidator._type;
    }),

  channels: z
    .string()
    .refine(
      (value) => {
        try {
          const isParsable = JSON.parse(value);

          //check if the parsed value is valid
          normalizedChannelValidator.parse(isParsable);

          return true;
        } catch (e) {
          return false;
        }
      },
      {
        message: "Channels is invalid",
      }
    )
    .transform((value) => {
      const parsed = JSON.parse(value);

      return parsed as typeof normalizedChannelValidator._type;
    }),
});

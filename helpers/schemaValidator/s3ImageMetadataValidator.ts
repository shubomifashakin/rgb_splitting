import { z } from "zod";

import { normalizedChannelValidator } from "./normalizedChannelsValidator";

import { grainValidator } from "./processValidator";

export const s3ImageMetadataValidator = z.object({
  project_name: z.string(),

  project_id: z.string().uuid(),

  grain: z
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

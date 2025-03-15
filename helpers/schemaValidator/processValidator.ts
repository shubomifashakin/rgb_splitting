import { z } from "zod";

import { normalizeChannel } from "../fns/channelsNormalization";

import { Channels, NormalizedChannels } from "../../types/channels";
import {
  default_grain,
  default_normalized_channel,
  defaultChannel,
  defaultGrain,
  maxInArray,
} from "../constants";

const possibleChannels = Object.values(Channels);

//channels could either be a string or a string array
//if the user sent just a string, use that string repeated 3 times, the want to use that channel for all channels
//the resulting value will always bbe an array
export const channelsValidator = z
  .union([
    z
      .string()
      .transform((val) => val.toLowerCase())
      .refine((val) => possibleChannels.includes(val as Channels), {
        message: "Invalid Process. Invalid channel value",
      }),

    //it must be a non emoty array
    z
      .array(z.string().transform((val) => val.toLowerCase()))
      .max(maxInArray)
      .refine(
        (arr) =>
          arr.every((val) => possibleChannels.includes(val as Channels)) &&
          arr.length,
        { message: "Invalid Process. Invalid channel value in array" }
      ),
  ]) //normalize the value of channels
  .transform(normalizeChannel)
  .optional()
  .default(defaultChannel);

//grain could either be a number or a number array
//if the user sent just a number, use that number repeated 3 times, the want to use that grain value for all channels
//the resulting value will be always be an array
export const grainValidator = z
  .union([
    z.number().transform((val) => Math.min(255, val)),

    z
      .array(z.number().transform((val) => Math.min(255, val)))
      .max(maxInArray)
      .refine((arr) => arr.length, {
        message: "No grain values provided in array",
      }),
  ])
  .transform((val) =>
    //if the value is a number, return an array of that number repeated 3 times
    Array.isArray(val) ? val : Array.from({ length: 3 }, () => val)
  )
  .optional()
  .default(defaultGrain);

//i wanted a situation where users can exclude either channels or grain but not both
export const processValidator = z
  .object({
    channels: channelsValidator,
    grain: grainValidator,
  })
  .refine(
    (data) => {
      return data.channels !== undefined || data.grain !== undefined;
    },
    {
      message: "At least one of 'channels' or 'grain' must be present.",
    }
  );

export type ChannelType = z.infer<typeof channelsValidator>;
export type grainType = z.infer<typeof grainValidator>;

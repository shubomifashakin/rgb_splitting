import { z } from "zod";

import { normalizeChannel } from "../fns/channelsNormalization";

import { Channels } from "../../types/channels";
import {
  defaultChannel,
  defaultGrain,
  maxProcessesInArray,
} from "../constants";

const possibleChannels = Object.values(Channels);

//channels could either be a string or a string array
//the resulting value will always bbe an array
//if the user specified just a string and not an array, use that channel value for all the grains
//if they specified an array, then just use that array
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
      .max(maxProcessesInArray)
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
//the resulting value will always be an array
//if the user specified just a number and not an array, use that grain value for all the channels
//if they specified an array, then just use that array
export const grainValidator = z
  .union([
    z.number().transform((val) => Math.min(255, val)),

    z
      .array(z.number().transform((val) => Math.min(255, val)))
      .max(maxProcessesInArray)
      .refine((arr) => arr.length, {
        message: "No grain values provided in array",
      }),
  ])
  .transform((val) => (Array.isArray(val) ? val : [val, val, val]))
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

export type grainType = z.infer<typeof grainValidator>;
export type ChannelType = z.infer<typeof channelsValidator>;

import { z } from "zod";

import { normalizeChannel } from "../fns/channelsNormalization";

import { Channels } from "../../types/channels";
import {
  defaultGrain,
  defaultChannel,
  maxProcessesInArray,
} from "../constants";

const possibleChannels = Object.values(Channels);

const channelValueValidator = z
  .string()
  .refine((val) => possibleChannels.includes(val as Channels), {
    message: "Invalid Process. Invalid channel value",
  });

const grainValueValidator = z.number().transform((val) => Math.min(255, val));

//channels could either be a string or a string array
//the resulting value will always bbe an array
//if the user specified just a string and not an array, use that channel value for all the grains
//if they specified an array, then just use that array
export const channelsValidator = z
  .union(
    [
      channelValueValidator,

      //it must be a non emoty array
      z
        .array(channelValueValidator)
        .min(1, {
          message: "At least one channel must be provided.",
        })
        .max(maxProcessesInArray, {
          message: "Too many channels provided",
        }),
    ],
    {
      message: "Invalid channel value. Expects a string or an array of strings",
    }
  ) //normalize the value of channels
  .transform(normalizeChannel)
  .optional()
  .default(defaultChannel);

//grain could either be a number or a number array
//the resulting value will always be an array
//if the user specified just a number and not an array, use that grain value for all the channels
//if they specified an array, then just use that array
export const grainValidator = z
  .union(
    [
      grainValueValidator,

      z
        .array(grainValueValidator)
        .min(1, {
          message: "At least one grain must be provided.",
        })
        .max(maxProcessesInArray, {
          message: "Too many grains provided",
        }),
    ],
    { message: "Invalid grain value. Expects a number or an array of numbers" }
  )
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

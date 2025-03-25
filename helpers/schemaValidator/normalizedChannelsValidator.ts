import { z } from "zod";

import { maxProcessesInArray } from "../constants";
import { NormalizedChannels } from "../../types/channels";

const channels = Object.values(NormalizedChannels);

function isChannels(value: unknown): value is NormalizedChannels {
  return channels.includes(value as NormalizedChannels);
}

const invalidNormalizedChannelMessage = "Invalid normalized channel";

export const normalizedChannelValidator = z
  .array(
    z.string().refine(isChannels, { message: invalidNormalizedChannelMessage }),
    {
      message: invalidNormalizedChannelMessage,
    }
  )
  .max(maxProcessesInArray, { message: "Too many channels provided." });

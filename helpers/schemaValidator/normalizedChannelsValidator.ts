import { z } from "zod";

import { maxProcessesInArray } from "../constants";
import { NormalizedChannels } from "../../types/channels";

const channels = Object.values(NormalizedChannels);

function isChannels(value: unknown): value is NormalizedChannels {
  return channels.includes(value as NormalizedChannels);
}

export const normalizedChannelValidator = z
  .array(z.string().refine(isChannels))
  .max(maxProcessesInArray);

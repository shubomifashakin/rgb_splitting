import { z } from "zod";

import { NormalizedChannels } from "../../types/channels";

const channels = Object.values(NormalizedChannels);

function isChannels(value: unknown): value is NormalizedChannels {
  return channels.includes(value as NormalizedChannels);
}

export const normalizedChannelValidator = z
  .array(z.string().refine(isChannels))
  .max(3);

import { NormalizedChannels } from "../../types/channels";

export const CHANNEL_MAP: Record<string, NormalizedChannels> = {
  r: NormalizedChannels.RED,
  g: NormalizedChannels.GREEN,
  b: NormalizedChannels.BLUE,
  rg: NormalizedChannels.REDGREEN,
  gr: NormalizedChannels.REDGREEN,
  rb: NormalizedChannels.REDBLUE,
  br: NormalizedChannels.REDBLUE,
  gb: NormalizedChannels.GREENBLUE,
  bg: NormalizedChannels.GREENBLUE,
  rgb: NormalizedChannels.REDGREENBLUE,
  rbg: NormalizedChannels.REDGREENBLUE,
  grb: NormalizedChannels.REDGREENBLUE,
  gbr: NormalizedChannels.REDGREENBLUE,
  brg: NormalizedChannels.REDGREENBLUE,
  bgr: NormalizedChannels.REDGREENBLUE,
};

/**
 * This Normalizes channel input into a stable representation.
 */
export function normalizeChannel(input: string | string[]) {
  const process = (str: string): NormalizedChannels => {
    //get the string they passed
    //find the key in the channel map
    //return the value
    const foundNormalization = CHANNEL_MAP[str];

    if (!foundNormalization) {
      throw new Error(`Invalid channel value: ${str}`);
    }

    return foundNormalization;
  };

  //if the input is an array, map over it and process each value
  //if the input is a string, process it && return an array of that value repeated 3 times
  return Array.isArray(input)
    ? input.map(process)
    : Array.from({ length: 3 }, () => process(input));
}

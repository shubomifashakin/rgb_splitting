import { Channels, NormalizedChannels } from "../types/channels";

export enum PlanType {
  Free = "free",
  Pro = "pro",
  Executive = "executive",
}

export const maxInArray = 3;
export const default_grain = 0;
export const default_channel = Channels.RGB;
export const default_normalized_channel = NormalizedChannels.REDGREENBLUE;

export const defaultGrain = [default_grain];
export const defaultChannel = [default_channel];
export const defaultNormalizedChannel = [default_normalized_channel];

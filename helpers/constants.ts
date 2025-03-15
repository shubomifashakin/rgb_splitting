import { Channels, NormalizedChannels } from "../types/channels";

export enum PlanType {
  Free = "free",
  Pro = "pro",
  Executive = "executive",
}

export const defaultGrain = [0];
export const defaultChannel = Channels.RGB;
export const defaultNormalizedChannel = [NormalizedChannels.REDGREENBLUE];

import { Channels, NormalizedChannels } from "../types/channels";

export enum PlanType {
  Free = "free",
  Pro = "pro",
  Executive = "executive",
}

export enum PROJECT_STATUS {
  Active = "active",
  Inactive = "inactive",
}

export const maxProcessesInArray = 3;
export const processedImagesRouteVar = "image";

export const default_grain = 0;
export const default_normalized_channel = NormalizedChannels.REDGREENBLUE;

export const defaultGrain = [default_grain];
export const defaultChannel = Channels.RGB;
export const defaultNormalizedChannel = [default_normalized_channel];

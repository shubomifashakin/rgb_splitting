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

export const defaultGrain = [0];
export const defaultChannel = Channels.RGB;
export const defaultNormalizedChannel = [NormalizedChannels.REDGREENBLUE];

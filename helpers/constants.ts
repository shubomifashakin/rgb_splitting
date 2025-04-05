import { Channels, NormalizedChannels } from "../types/channels";

export enum PlanType {
  Free = "free",
  Pro = "pro",
  Executive = "executive",
}

export enum PROJECT_STATUS {
  Inactive = "inactive",
  ActivePro = "active-pro",
  ActiveFree = "active-free",
  ActiveExecutive = "active-executive",
}

export const planTypeToStatus = {
  [PlanType.Pro]: PROJECT_STATUS.ActivePro,
  [PlanType.Free]: PROJECT_STATUS.ActiveFree,
  [PlanType.Executive]: PROJECT_STATUS.ActiveExecutive,
};

export const maxProcessesInArray = 3;
export const maxActiveFreeProjects = 3;
export const processedImagesRouteVar = "image";

export const default_grain = 0;
export const default_normalized_channel = NormalizedChannels.REDGREENBLUE;

export const defaultGrain = [default_grain];
export const defaultChannel = Channels.RGB;
export const defaultNormalizedChannel = [default_normalized_channel];

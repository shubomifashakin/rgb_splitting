import { NormalizedChannels } from "./channels";

export type ProcessedImage = {
  url: string;
  grain: number;
  channels: NormalizedChannels;
};

export type ProcessedImagesInfo = {
  imageId: string;
  projectId: string;
  createdAt: number;
  originalImageUrl: string;
  results: ProcessedImage[];
};

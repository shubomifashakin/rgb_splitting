import { ImageData } from "canvas";

import { getRedChannel } from "./channelFns/getRedChannel";
import { getBlueChannel } from "./channelFns/getBlueChannel";
import { getGreenChannel } from "./channelFns/getGreenChannel";
import { getRedAndBlueChannels } from "./channelFns/getRedAndBlueChannels";
import { getRedAndGreenChannels } from "./channelFns/getRedAndGreenChannels";
import { getGreenAndBlueChannels } from "./channelFns/getGreenAndBlueChannels";
import { getRedGreenAndBlueChannels } from "./channelFns/getRedGreenAndBlueChannels";

import { NormalizedChannels } from "../types/channels";
import {
  grainType,
  ChannelType,
} from "../helpers/schemaValidator/processValidator";

const channelFns: Record<
  NormalizedChannels,
  (args: { imageData: ImageData; grain: number }) => ImageData
> = {
  [NormalizedChannels.RED]: getRedChannel,
  [NormalizedChannels.BLUE]: getBlueChannel,
  [NormalizedChannels.GREEN]: getGreenChannel,
  [NormalizedChannels.REDBLUE]: getRedAndBlueChannels,
  [NormalizedChannels.REDGREEN]: getRedAndGreenChannels,
  [NormalizedChannels.GREENBLUE]: getGreenAndBlueChannels,
  [NormalizedChannels.REDGREENBLUE]: getRedGreenAndBlueChannels,
};

export async function processImage({
  grains,
  channels,
  imageData,
  bucketName,
  originalImageKey,
}: {
  grains: grainType;
  bucketName: string;
  imageData: ImageData;
  channels: ChannelType;
  originalImageKey: string;
}) {
  let processedImages: ImageData[] = [];
  let processedInfo: {
    key: string;
    url: string;
    grain: number;
    channel: NormalizedChannels;
  }[] = [];

  //if the channels and grains specified are qual, then process each channel with the corresponding grain at that index
  if (channels.length === grains.length) {
    processedImages = await Promise.all(
      channels
        .map((channel, index) => {
          const grain = grains[index];
          //remove any process that result in the same image uploaded
          if (channel === NormalizedChannels.REDGREENBLUE && grain === 0) {
            return;
          }

          const { url, key } = formImageKeyAndUrl({
            grain,
            channel,
            bucketName,
            originalImageKey,
          });

          processedInfo.push({
            url,
            key,
            grain,
            channel,
          });

          return channelFns[channel]({
            grain,
            imageData,
          });
        })
        .filter((image) => image !== undefined)
    );
  }

  //if they sent more channels than grains & there are at least 2 grains
  //use a grain value of 0 for the channel without a corresponding grain
  if (channels.length > grains.length && grains.length >= 2) {
    processedImages = await Promise.all(
      channels
        .map((channel, index) => {
          const grain = grains[index] ?? 0;

          //remove any process that result in the same image uploaded
          if (channel === NormalizedChannels.REDGREENBLUE && grain === 0) {
            return;
          }

          const { url, key } = formImageKeyAndUrl({
            grain,
            channel,
            bucketName,
            originalImageKey,
          });

          processedInfo.push({
            key,
            url,
            grain,
            channel,
          });

          return channelFns[channel]({
            grain,
            imageData,
          });
        })
        .filter((image) => image !== undefined)
    );
  }

  //if they sent more grains than channels & there are at least 2 channels
  //skip all grains that do not have a corresponding channel
  if (grains.length > channels.length && channels.length >= 2) {
    processedImages = await Promise.all(
      grains
        .map((grain, index) => {
          const channel = channels[index];

          //if a channel does not exist at the current index, skip
          if (!channel) {
            return;
          }

          //remove any process that result in the same image uploaded
          if (channel === NormalizedChannels.REDGREENBLUE && grain === 0) {
            return;
          }

          const { url, key } = formImageKeyAndUrl({
            grain,
            channel,
            bucketName,
            originalImageKey,
          });

          processedInfo.push({
            url,
            key,
            grain,
            channel,
          });

          return channelFns[channel]({
            grain,
            imageData,
          });
        })
        .filter((image) => image !== undefined)
    );
  }

  //if they sent just 1 channel & they sent more grains than channels, use that channel for all the grains
  if (channels.length === 1 && grains.length > channels.length) {
    processedImages = await Promise.all(
      grains
        .map((grain) => {
          const channel = channels[0];

          //remove any process that result in the same image uploaded
          if (channel === NormalizedChannels.REDGREENBLUE && grain === 0) {
            return;
          }

          const { url, key } = formImageKeyAndUrl({
            grain,
            channel,
            bucketName,
            originalImageKey,
          });

          processedInfo.push({
            url,
            key,
            grain,
            channel,
          });

          return channelFns[channel]({
            grain,
            imageData,
          });
        })
        .filter((image) => image !== undefined)
    );
  }

  //if they sent just 1 grain & they sent more channels, use that grain for all the channels
  if (grains.length === 1 && channels.length > grains.length) {
    processedImages = await Promise.all(
      channels
        .map((channel) => {
          const grain = grains[0];

          //remove any process that results in the same image uploaded
          if (channel === NormalizedChannels.REDGREENBLUE && grain === 0) {
            return;
          }

          const { url, key } = formImageKeyAndUrl({
            grain,
            channel,
            bucketName,
            originalImageKey,
          });

          processedInfo.push({
            url,
            key,
            grain,
            channel,
          });

          return channelFns[channel]({
            imageData,
            grain,
          });
        })
        .filter((image) => image !== undefined)
    );
  }

  return { images: processedImages, processedInfo };
}

function formImageKeyAndUrl({
  grain,
  channel,
  bucketName,
  originalImageKey,
}: {
  grain: number;
  bucketName: string;
  originalImageKey: string;
  channel: NormalizedChannels;
}) {
  const key = `${originalImageKey}/${channel}-${grain}`;
  const url = `https://${bucketName}.s3.us-east-1.amazonaws.com/${key}`;

  return { key, url };
}

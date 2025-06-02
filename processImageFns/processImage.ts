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
import {
  default_grain,
  default_normalized_channel,
} from "../helpers/constants";

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
  region,
  grains,
  channels,
  imageData,
  bucketName,
  originalImageKey,
  format = "jpg",
}: {
  region: string;
  grains: grainType;
  bucketName: string;
  imageData: ImageData;
  channels: ChannelType;
  originalImageKey: string;
  format?: "jpg" | "png";
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

          //skip any process that result in the same image uploaded
          if (isTheSameImage({ channel, grain })) {
            return;
          }

          const { url, key } = formImageKeyAndUrl({
            grain,
            region,
            format,
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

  //if they sent more channels than grains
  //use a grain value of 0 for the channels without a corresponding grain
  if (channels.length > grains.length) {
    processedImages = await Promise.all(
      channels
        .map((channel, index) => {
          const grain = grains[index] ?? 0;

          //skip any process that result in the same image uploaded
          if (isTheSameImage({ channel, grain })) {
            return;
          }

          const { url, key } = formImageKeyAndUrl({
            grain,
            region,
            channel,
            format,
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

  //if they sent more grains than channels
  //skip all grains that do not have a corresponding channel
  if (grains.length > channels.length) {
    processedImages = await Promise.all(
      grains
        .map((grain, index) => {
          const channel = channels[index];

          //if a channel does not exist at the current index, skip
          if (!channel) {
            return;
          }

          //skip any process that result in the same image uploaded
          if (isTheSameImage({ channel, grain })) {
            return;
          }

          const { url, key } = formImageKeyAndUrl({
            grain,
            region,
            format,
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

  return { images: processedImages, processedInfo };
}

function formImageKeyAndUrl({
  grain,
  region,
  channel,
  bucketName,
  originalImageKey,
  format = "jpg",
}: {
  grain: number;
  region: string;
  bucketName: string;
  originalImageKey: string;
  channel: NormalizedChannels;
  format?: "jpg" | "png";
}) {
  const key = `${originalImageKey}/${channel}-${grain}`;
  const url = `https://${bucketName}.s3.${region}.amazonaws.com/${key}.${format}`;

  return { key, url };
}

function isTheSameImage({
  channel,
  grain,
}: {
  channel: NormalizedChannels;
  grain: number;
}) {
  return channel === default_normalized_channel && grain === default_grain;
}

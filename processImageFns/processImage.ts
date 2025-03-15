import { ImageData } from "canvas";

import { getRedChannel } from "./channelFns/getRedChannel";
import { getBlueChannel } from "./channelFns/getBlueChannel";
import { getGreenChannel } from "./channelFns/getGreenChannel";
import { getRedAndBlueChannels } from "./channelFns/getRedAndBlueChannels";
import { getRedAndGreenChannels } from "./channelFns/getRedAndGreenChannels";
import { getGreenAndBlueChannels } from "./channelFns/getGreenAndBlueChannels";

import { NormalizedChannels } from "../types/channels";
import {
  grainType,
  ChannelType,
} from "../helpers/schemaValidator/processValidator";
import { getRedGreenAndBlueChannels } from "./channelFns/getRedGreenAndBlueChannels";

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
  imageData,
  channels,
  grains,
  keyPrefix,
  bucketName,
}: {
  imageData: ImageData;
  channels: ChannelType;
  grains: grainType;
  keyPrefix: string;
  bucketName: string;
}) {
  let processedImages: ImageData[] = [];
  let processedInfo: {
    channel: NormalizedChannels;
    grain: number;
    key: string;
    url: string;
  }[] = [];

  //if the channels and grains specified are qual, then process each channel with the corresponding grain at that index
  if (channels.length === grains.length) {
    processedImages = await Promise.all(
      channels
        .map((channel, index) => {
          //remove any process that result in the same image uploaded
          if (
            channel === NormalizedChannels.REDGREENBLUE &&
            grains[index] === 0
          ) {
            return;
          }

          processedInfo.push({
            channel,
            grain: grains[index],
            key: `${keyPrefix}-${channel}-${grains[index]}`,
            url: `https://${bucketName}.s3.us-east-1.amazonaws.com/${keyPrefix}-${channel}-${grains[index]}`,
          });

          return channelFns[channel]({
            imageData,
            grain: grains[index],
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

          processedInfo.push({
            channel,
            grain,
            key: `${keyPrefix}-${channel}-${grain}`,
            url: `https://${bucketName}.s3.us-east-1.amazonaws.com/${keyPrefix}-${channel}-${grain}`,
          });

          return channelFns[channel]({
            imageData,
            grain,
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
          const channelExistsAtIndex = channels[index];

          //if a channel does not exist at the current index, skip
          if (!channelExistsAtIndex) {
            return;
          }

          //remove any process that result in the same image uploaded
          if (
            channelExistsAtIndex === NormalizedChannels.REDGREENBLUE &&
            grain === 0
          ) {
            return;
          }

          processedInfo.push({
            channel: channelExistsAtIndex,
            grain,
            key: `${keyPrefix}-${channelExistsAtIndex}-${grain}`,
            url: `https://${bucketName}.s3.us-east-1.amazonaws.com/${keyPrefix}-${channelExistsAtIndex}-${grain}`,
          });

          return channelFns[channelExistsAtIndex]({
            imageData,
            grain,
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

          processedInfo.push({
            channel,
            grain,
            key: `${keyPrefix}-${channel}-${grain}`,
            url: `https://${bucketName}.s3.us-east-1.amazonaws.com/${keyPrefix}-${channel}-${grain}`,
          });

          return channelFns[channel]({
            imageData,
            grain,
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
          //remove any process that results in the same image uploaded
          if (channel === NormalizedChannels.REDGREENBLUE && grains[0] === 0) {
            return;
          }

          processedInfo.push({
            channel,
            grain: grains[0],
            key: `${keyPrefix}-${channel}-${grains[0]}`,
            url: `https://${bucketName}.s3.us-east-1.amazonaws.com/${keyPrefix}-${channel}-${grains[0]}`,
          });

          return channelFns[channel]({
            imageData,
            grain: grains[0],
          });
        })
        .filter((image) => image !== undefined)
    );
  }

  return { images: processedImages, processedInfo };
}

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

export async function processImage(
  imageData: ImageData,
  channels: ChannelType,
  grains: grainType
) {
  const keys: string[] = [];
  let processedImages: ImageData[] = [];

  //if the grains are greater than channels specified, and only one channel is specified, then process each grain with that channel
  //essentially the same channel is used but there would be different distorted images of that 1 channel
  if (grains.length > channels.length && channels.length === 1) {
    processedImages = await Promise.all(
      grains
        .map((grain) => {
          //remove any process that result in the same image uploaded
          if (channels[0] === NormalizedChannels.REDGREENBLUE && grain === 0) {
            return;
          }

          keys.push(`${channels[0]}-${grain}`);

          return channelFns[channels[0]]({ imageData, grain });
        })
        .filter((image) => image !== undefined)
    );
  }

  //if the grains are greater than channels specified, but more than one channel is specified, then process each grain with the channel value for that grain index
  //if no channel exists for that grain index, skip it
  if (grains.length > channels.length && channels.length > 1) {
    processedImages = await Promise.all(
      grains
        .map((grain, index) => {
          const channel = channels[index];

          //remove any process that result in the same image uploaded
          if (
            !channel ||
            (channel === NormalizedChannels.REDGREENBLUE && grain === 0)
          ) {
            return;
          }

          keys.push(`${channel}-${grain}`);

          return channelFns[channel]({ imageData, grain });
        })
        .filter((image) => image !== undefined)
    );
  }

  //if the channels and grains specified are qual, then process each channel with the grain value for that channel index
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
          keys.push(`${channel}-${grains[index]}`);

          return channelFns[channel]({
            imageData,
            grain: grains[index],
          });
        })
        .filter((image) => image !== undefined)
    );
  }

  //if the channels specified is greater than the grains specified, then process each channel with the grain value for that channel index
  //if no grain exists for the channel at that index, use 0
  if (channels.length > grains.length) {
    processedImages = await Promise.all(
      channels
        .map((channel, index) => {
          const grain = grains[index] ? grains[index] : 0;

          //remove any process that result in the same image uploaded
          if (channel === NormalizedChannels.REDGREENBLUE && grain === 0) {
            return;
          }

          keys.push(`${channel}-${grain}`);

          return channelFns[channel]({
            imageData,
            grain: grain,
          });
        })
        .filter((image) => image !== undefined)
    );
  }

  return { images: processedImages, keys };
}

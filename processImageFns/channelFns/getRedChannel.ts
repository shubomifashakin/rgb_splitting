import { ImageData } from "canvas";
import { ChannelFnType } from "../../types/channelFnsTypes";
import { grainEffect } from "../../helpers/fns/grainEffect";

export function getRedChannel({ imageData, grain }: ChannelFnType) {
  const { data, width, height } = imageData;

  const redChannel = new ImageData(width, height);

  for (let i = 0; i < data.length; i += 4) {
    const redValue = grainEffect(data[i], grain);

    redChannel.data[i] = redValue;
    redChannel.data[i + 1] = 0;
    redChannel.data[i + 2] = 0;
    redChannel.data[i + 3] = data[i + 3];
  }

  return redChannel;
}

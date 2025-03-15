import { ImageData } from "canvas";
import { ChannelFnType } from "../../types/channelFnsTypes";
import { grainEffect } from "../../helpers/fns/grainEffect";

export function getRedAndBlueChannels({ imageData, grain }: ChannelFnType) {
  const { data, width, height } = imageData;

  const redBlueChannel = new ImageData(width, height);

  for (let i = 0; i < data.length; i += 4) {
    const redValue = grainEffect(data[i], grain);
    const blueValue = grainEffect(data[i + 2], grain);

    redBlueChannel.data[i] = redValue;
    redBlueChannel.data[i + 1] = 0;
    redBlueChannel.data[i + 2] = blueValue;
    redBlueChannel.data[i + 3] = data[i + 3];
  }

  return redBlueChannel;
}

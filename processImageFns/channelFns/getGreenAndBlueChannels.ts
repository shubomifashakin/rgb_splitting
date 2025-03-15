import { ImageData } from "canvas";
import { ChannelFnType } from "../../types/channelFnsTypes";
import { grainEffect } from "../../helpers/fns/grainEffect";

export function getGreenAndBlueChannels({ imageData, grain }: ChannelFnType) {
  const { data, width, height } = imageData;

  const greenBlueChannel = new ImageData(width, height);

  for (let i = 0; i < data.length; i += 4) {
    const greenValue = grainEffect(data[i + 1], grain);
    const blueValue = grainEffect(data[i + 2], grain);

    greenBlueChannel.data[i] = 0;
    greenBlueChannel.data[i + 1] = greenValue;
    greenBlueChannel.data[i + 2] = blueValue;
    greenBlueChannel.data[i + 3] = data[i + 3];
  }

  return greenBlueChannel;
}

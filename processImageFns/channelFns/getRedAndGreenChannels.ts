import { ImageData } from "canvas";
import { ChannelFnType } from "../../types/channelFnsTypes";
import { grainEffect } from "../../helpers/fns/grainEffect";

export function getRedAndGreenChannels({ imageData, grain }: ChannelFnType) {
  const { data, width, height } = imageData;

  const redGreenChannel = new ImageData(width, height);

  for (let i = 0; i < data.length; i += 4) {
    const redValue = grainEffect(data[i], grain);
    const greenValue = grainEffect(data[i + 1], grain);

    redGreenChannel.data[i] = redValue;
    redGreenChannel.data[i + 1] = greenValue;
    redGreenChannel.data[i + 2] = 0;
    redGreenChannel.data[i + 3] = data[i + 3];
  }

  return redGreenChannel;
}

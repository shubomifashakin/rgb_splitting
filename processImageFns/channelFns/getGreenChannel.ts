import { ImageData } from "canvas";
import { ChannelFnType } from "../../types/channelFnsTypes";
import { grainEffect } from "../../helpers/fns/grainEffect";

export function getGreenChannel({ imageData, grain }: ChannelFnType) {
  const { data, width, height } = imageData;

  const greenChannel = new ImageData(width, height);

  for (let i = 0; i < data.length; i += 4) {
    const greenValue = grainEffect(data[i + 1], grain);

    greenChannel.data[i] = 0;
    greenChannel.data[i + 1] = greenValue;
    greenChannel.data[i + 2] = 0;
    greenChannel.data[i + 3] = data[i + 3];
  }

  return greenChannel;
}

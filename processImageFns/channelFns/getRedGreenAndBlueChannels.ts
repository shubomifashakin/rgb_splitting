import { ImageData } from "canvas";
import { ChannelFnType } from "../../types/channelFnsTypes";
import { grainEffect } from "../../helpers/fns/grainEffect";

//no edits just return the same thing
export function getRedGreenAndBlueChannels({
  imageData,
  grain,
}: ChannelFnType) {
  const { data, width, height } = imageData;

  const image = new ImageData(width, height);

  for (let i = 0; i < data.length; i += 4) {
    const redValue = grainEffect(data[i], grain);
    const greenValue = grainEffect(data[i + 1], grain);
    const blueValue = grainEffect(data[i + 2], grain);

    image.data[i] = redValue;
    image.data[i + 1] = greenValue;
    image.data[i + 2] = blueValue;
    image.data[i + 3] = data[i + 3];
  }

  return image;
}

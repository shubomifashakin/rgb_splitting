import { z } from "zod";

export const processValidator = z
  .object({
    channels: z
      .enum([
        "rgb",
        "rbg",
        "grb",
        "gbr",
        "brg",
        "bgr",
        "r",
        "g",
        "b",
        "rg",
        "rb",
        "gr",
        "gb",
        "br",
        "bg",
        "RGB",
        "RBG",
        "GRB",
        "GBR",
        "BRG",
        "BGR",
        "R",
        "G",
        "B",
        "RG",
        "RB",
        "GR",
        "GB",
        "BR",
        "BG",
      ])
      .optional(),
    distortion: z.number().default(0).optional(),
  })
  .refine(
    (data) => {
      return data.channels !== undefined || data.distortion !== undefined;
    },
    {
      message: "At least one of 'channels' or 'distortion' must be present.",
    }
  );

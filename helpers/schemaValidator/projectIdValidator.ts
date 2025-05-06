import { z } from "zod";

export const projectIdValidator = z.string().uuid();

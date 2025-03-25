import { ZodError } from "zod";

export function transformZodError(error: ZodError) {
  const errors = error.errors.map((c) => {
    return {
      message: c.message,
      path: c.path,
    };
  });

  return JSON.stringify({ errors });
}

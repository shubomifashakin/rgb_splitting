export function grainEffect(value: number, grain: number) {
  return Math.min(255, value + grain * Math.random());
}

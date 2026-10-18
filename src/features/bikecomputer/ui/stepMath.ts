/** The arithmetic of a stepper: one press moves by `step`, never outside `min..max`, never off the step grid. Pure. */

export interface StepRange {
  min: number;
  max: number;
  step: number;
}

/** `value` moved by `direction` steps and clamped. A value off the grid (a stored 1250 on a 500 grid) snaps to the next grid point in that direction. */
export function stepValue(value: number, direction: -1 | 1, { min, max, step }: StepRange): number {
  const grid = (value - min) / step;
  const snapped = direction > 0 ? Math.floor(grid + 1e-9) + 1 : Math.ceil(grid - 1e-9) - 1;
  return Math.min(max, Math.max(min, min + snapped * step));
}

/** Whether pressing in `direction` would change anything. */
export function canStep(value: number, direction: -1 | 1, range: StepRange): boolean {
  return stepValue(value, direction, range) !== value;
}

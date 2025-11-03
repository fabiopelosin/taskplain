const UNIT_TO_MILLISECONDS: Record<string, number> = {
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  m: 30 * 24 * 60 * 60 * 1000,
  y: 365 * 24 * 60 * 60 * 1000,
};

const SUPPORTED_UNITS = Object.keys(UNIT_TO_MILLISECONDS).sort(
  (a, b) => UNIT_TO_MILLISECONDS[a] - UNIT_TO_MILLISECONDS[b],
);

export function parseRelativeAgeToMs(raw: string): number {
  const value = raw.trim().toLowerCase();
  const match = value.match(/^(\d+)([hdwmy])$/);
  if (!match) {
    throw new Error(
      `Invalid duration '${raw}'. Expected <number><unit> with unit in ${SUPPORTED_UNITS.join(
        ", ",
      )} (e.g., 3h, 2d, 1w, 6m)`,
    );
  }

  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Duration value must be a positive integer");
  }

  const unit = match[2];
  const multiplier = UNIT_TO_MILLISECONDS[unit];
  return amount * multiplier;
}

export function describeSupportedRelativeUnits(): string {
  return SUPPORTED_UNITS.join(", ");
}

const wholeDollarFormatter = new Intl.NumberFormat("en-US");
const compactDollarFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatCompactUsd(minorUnits: number) {
  const sign = minorUnits < 0 ? "-" : "";
  const absoluteMinorUnits = Math.abs(minorUnits);
  const wholeDollars = Math.trunc(absoluteMinorUnits / 100);

  return `${sign}$${compactDollarFormatter.format(wholeDollars)}`;
}

export function formatUsd(minorUnits: number) {
  const sign = minorUnits < 0 ? "-" : "";
  const absoluteMinorUnits = Math.abs(minorUnits);
  const wholeDollars = Math.trunc(absoluteMinorUnits / 100);
  const cents = absoluteMinorUnits % 100;

  return `${sign}$${wholeDollarFormatter.format(wholeDollars)}.${String(
    cents,
  ).padStart(2, "0")}`;
}

export function formatUpdatedAt(isoTimestamp: string) {
  return timestampFormatter.format(new Date(isoTimestamp));
}

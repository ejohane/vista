const wholeDollarFormatter = new Intl.NumberFormat("en-US");
const compactDollarFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact",
});
const monthLabels = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

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

export function formatSignedUsd(minorUnits: number) {
  if (minorUnits === 0) {
    return "$0.00";
  }

  const sign = minorUnits > 0 ? "+" : "-";

  return `${sign}${formatUsd(Math.abs(minorUnits))}`;
}

export function formatUpdatedAt(isoTimestamp: string) {
  const timestamp = new Date(isoTimestamp);
  const month = monthLabels[timestamp.getUTCMonth()];
  const day = timestamp.getUTCDate();
  const year = timestamp.getUTCFullYear();
  const hours24 = timestamp.getUTCHours();
  const minutes = String(timestamp.getUTCMinutes()).padStart(2, "0");
  const hours12 = hours24 % 12 || 12;
  const meridiem = hours24 >= 12 ? "PM" : "AM";

  return `${month} ${day}, ${year} at ${hours12}:${minutes} ${meridiem} UTC`;
}

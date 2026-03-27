const APP_TIMEZONE = process.env.APP_TIMEZONE?.trim() || "Africa/Johannesburg";

function twoDigit(value: string | undefined) {
  return value?.padStart(2, "0") ?? "00";
}

function extractPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value;
}

export function formatDateTimeInAppTimezone(value: Date | string | number) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const year = extractPart(parts, "year") ?? "0000";
  const month = twoDigit(extractPart(parts, "month"));
  const day = twoDigit(extractPart(parts, "day"));
  const hour = twoDigit(extractPart(parts, "hour"));
  const minute = twoDigit(extractPart(parts, "minute"));
  const second = twoDigit(extractPart(parts, "second"));

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function getAppTimezone() {
  return APP_TIMEZONE;
}


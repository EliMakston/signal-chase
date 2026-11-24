export const DEFAULT_RETRY_AFTER_SECONDS = 60n;

/** Returns a positive delay in seconds; invalid or expired values use the fallback. */
export function parseRetryAfter(
    value: string | null,
    now: () => number = Date.now,
): bigint {
    const text = value?.trim() ?? "";
    if (/^\d+$/.test(text)) {
        const seconds = BigInt(text);
        return seconds > 0n ? seconds : DEFAULT_RETRY_AFTER_SECONDS;
    }
    // Date.parse alone also accepts many non-HTTP date and numeric formats.
    const imf = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text);
    const rfc850 = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(text);
    const asctime = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d{2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(text);
    const parts = imf ?? rfc850;
    if (parts || asctime) {
        const current = now();
        const day = Number(parts ? parts[2] : asctime![3]);
        const month = (parts ? parts[3] : asctime![2]);
        let year = Number(parts ? parts[4] : asctime![7]);
        if (rfc850) {
            year += Math.floor(new Date(current).getUTCFullYear() / 100) * 100;
            if (year > new Date(current).getUTCFullYear() + 50) year -= 100;
        }
        const hour = Number(parts ? parts[5] : asctime![4]);
        const minute = Number(parts ? parts[6] : asctime![5]);
        const second = Number(parts ? parts[7] : asctime![6]);
        const monthIndex = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(month);
        const date = new Date(Date.UTC(year, monthIndex, day, hour, minute, second));
        const timestamp = date.getTime();
        const weekday = (parts ? parts[1] : asctime![1]).slice(0, 3);
        if (
            date.getUTCFullYear() === year && date.getUTCMonth() === monthIndex &&
            date.getUTCDate() === day && date.getUTCHours() === hour &&
            date.getUTCMinutes() === minute && date.getUTCSeconds() === second &&
            date.toUTCString().startsWith(weekday) && timestamp > current
        ) {
            return BigInt(Math.ceil((timestamp - current) / 1000));
        }
    }
    return DEFAULT_RETRY_AFTER_SECONDS;
}

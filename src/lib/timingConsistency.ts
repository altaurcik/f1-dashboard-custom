import type { Message, TimingDataDriver } from "@/types/state.type";

export function canShowQualifyingGap(timing: TimingDataDriver) {
	return Boolean(timing.BestLapTime?.Value);
}

export function isLastLapDeleted(timing: TimingDataDriver, messages: readonly Message[] | undefined) {
	const value = timing.LastLapTime?.Value;
	const lap = timing.LastLapTime?.Lap ?? timing.NumberOfLaps;
	if (!value || !Number.isInteger(lap)) return false;
	return (messages ?? []).some((message) => {
		const record = message.Message.match(
			/\bCAR\s+(\d+)\b.*?\bTIME\s+(\d+:\d{2}\.\d{3})\s+DELETED\b.*?\bLAP\s+(\d+)\b/i,
		);
		return record?.[1] === timing.RacingNumber && record[2] === value && Number(record[3]) === lap;
	});
}
export function isIntermediateQualifyingFinish(
	type: string | undefined,
	name: string | undefined,
	status: string | undefined,
	part: number | undefined,
) {
	return (
		status === "Finished" && (part === 1 || part === 2) && [type, name].some((value) => /qualifying/i.test(value ?? ""))
	);
}

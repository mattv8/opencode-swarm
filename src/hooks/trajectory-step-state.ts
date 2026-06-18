/**
 * Module-level trajectory step counters shared by runtime reset code and the
 * trajectory logger without creating a state <-> hook import cycle.
 */

const sessionStepCounters = new Map<string, number>();

export function nextTrajectoryStep(sessionId: string): number {
	const step = (sessionStepCounters.get(sessionId) ?? 0) + 1;
	sessionStepCounters.set(sessionId, step);
	return step;
}

export function resetTrajectoryStepCounter(sessionId: string): void {
	sessionStepCounters.set(sessionId, 0);
}

export function clearTrajectoryStepCounters(sessionId?: string): void {
	if (sessionId !== undefined) {
		sessionStepCounters.delete(sessionId);
	} else {
		sessionStepCounters.clear();
	}
}

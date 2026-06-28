/**
 * Shared verdict normalization utilities for evidence writers.
 *
 * Centralizes the uppercase→lowercase verdict mapping that was previously
 * duplicated across write_drift_evidence, write_hallucination_evidence,
 * and write_mutation_evidence.
 *
 * Two distinct verdict sets are supported:
 * - 2-value (drift / hallucination): APPROVED ↔ approved, NEEDS_REVISION ↔ rejected
 * - 4-value (mutation): PASS/WARN/FAIL/SKIP ↔ pass/warn/fail/skip
 *
 * All functions are pure and throw on invalid input, matching the original
 * per-file behavior exactly.
 */

/**
 * Normalize a 2-value drift/hallucination verdict to lowercase.
 * @param verdict - Raw verdict from VERDICT_SET_2 (base: 'APPROVED' | 'NEEDS_REVISION'; extensible)
 * @returns Normalized verdict: 'approved' | 'rejected' | lowercase form for extended verdicts
 * @throws Error if verdict is not one of the allowed values in the live set
 */
// Overloads for type narrowing on known verdicts (extended verdicts remain string)
export function normalizeVerdict2(verdict: 'APPROVED'): 'approved';
export function normalizeVerdict2(verdict: 'NEEDS_REVISION'): 'rejected';
export function normalizeVerdict2(
	verdict: 'APPROVED' | 'NEEDS_REVISION',
): 'approved' | 'rejected';
export function normalizeVerdict2(verdict: string): string;
export function normalizeVerdict2(verdict: string): string {
	if (!LIVE_VERDICT_SET_2.includes(verdict)) {
		throw new Error(
			`Invalid verdict: must be 'APPROVED' or 'NEEDS_REVISION', got '${verdict}'`,
		);
	}
	switch (verdict) {
		case 'APPROVED':
			return 'approved';
		case 'NEEDS_REVISION':
			return 'rejected';
		default:
			// Extended verdicts (e.g. NEEDS_DISCUSSION) normalize to lowercase form.
			// Single-source: extending LIVE_VERDICT_SET_2 makes this accept without per-writer changes.
			return verdict.toLowerCase();
	}
}

/**
 * Normalize a 4-value mutation verdict to lowercase.
 * @param verdict - Raw verdict from VERDICT_SET_4 (base: 'PASS' | 'WARN' | 'FAIL' | 'SKIP'; extensible)
 * @returns Normalized verdict: 'pass' | 'warn' | 'fail' | 'skip' | lowercase form for extended verdicts
 * @throws Error if verdict is not one of the allowed values in the live set
 */
// Overloads for type narrowing on known verdicts (extended verdicts remain string)
export function normalizeVerdict4(verdict: 'PASS'): 'pass';
export function normalizeVerdict4(verdict: 'WARN'): 'warn';
export function normalizeVerdict4(verdict: 'FAIL'): 'fail';
export function normalizeVerdict4(verdict: 'SKIP'): 'skip';
export function normalizeVerdict4(
	verdict: 'PASS' | 'WARN' | 'FAIL' | 'SKIP',
): 'pass' | 'warn' | 'fail' | 'skip';
export function normalizeVerdict4(verdict: string): string;
export function normalizeVerdict4(verdict: string): string {
	if (!LIVE_VERDICT_SET_4.includes(verdict)) {
		throw new Error(
			`Invalid verdict: must be 'PASS', 'WARN', 'FAIL', or 'SKIP', got '${verdict}'`,
		);
	}
	switch (verdict) {
		case 'PASS':
			return 'pass';
		case 'WARN':
			return 'warn';
		case 'FAIL':
			return 'fail';
		case 'SKIP':
			return 'skip';
		default:
			// Extended verdicts normalize to lowercase form.
			// Single-source: extending LIVE_VERDICT_SET_4 makes this accept without per-writer changes.
			return verdict.toLowerCase();
	}
}

/**
 * Dependency-injection seam for testing. Tests can temporarily replace these
 * to verify that evidence writers delegate to the shared normalize-verdict module.
 * Restore each entry in afterEach via the saved original reference.
 *
 * VERDICT_SET_* are the single source of truth. Writers import VERDICT_SET_2 / _4
 * for their Zod schemas and isAcceptedVerdict* for runtime checks. Adding a value
 * here (or via _internals for tests) makes all three writers accept it with no
 * per-writer edits.
 */
const LIVE_VERDICT_SET_2: string[] = ['APPROVED', 'NEEDS_REVISION'];
const LIVE_VERDICT_SET_4: string[] = ['PASS', 'WARN', 'FAIL', 'SKIP'];

export const VERDICT_SET_2 = LIVE_VERDICT_SET_2 as readonly string[];
export type Verdict2 = (typeof LIVE_VERDICT_SET_2)[number];

export const VERDICT_SET_4 = LIVE_VERDICT_SET_4 as readonly string[];
export type Verdict4 = (typeof LIVE_VERDICT_SET_4)[number];

export function isAcceptedVerdict2(v: string): v is Verdict2 {
	return LIVE_VERDICT_SET_2.includes(v);
}

export function isAcceptedVerdict4(v: string): v is Verdict4 {
	return LIVE_VERDICT_SET_4.includes(v);
}

export const _internals: {
	normalizeVerdict2: typeof normalizeVerdict2;
	normalizeVerdict4: typeof normalizeVerdict4;
	VERDICT_SET_2: string[];
	VERDICT_SET_4: string[];
	isAcceptedVerdict2: typeof isAcceptedVerdict2;
	isAcceptedVerdict4: typeof isAcceptedVerdict4;
	setVerdictSet2: (values: string[]) => void;
	setVerdictSet4: (values: string[]) => void;
	getVerdictSet2: () => string[];
	getVerdictSet4: () => string[];
} = {
	normalizeVerdict2,
	normalizeVerdict4,
	VERDICT_SET_2: LIVE_VERDICT_SET_2,
	VERDICT_SET_4: LIVE_VERDICT_SET_4,
	isAcceptedVerdict2,
	isAcceptedVerdict4,
	/**
	 * Test-only: replace the live 2-value verdict set (single source for drift/hallucination writers).
	 * All writers that import isAcceptedVerdict2 / VERDICT_SET_2 / normalizeVerdict2
	 * will observe the new values with no per-writer code changes.
	 */
	setVerdictSet2(values: string[]) {
		LIVE_VERDICT_SET_2.length = 0;
		LIVE_VERDICT_SET_2.push(...values);
	},
	/**
	 * Test-only: replace the live 4-value verdict set (single source for mutation writer).
	 */
	setVerdictSet4(values: string[]) {
		LIVE_VERDICT_SET_4.length = 0;
		LIVE_VERDICT_SET_4.push(...values);
	},
	getVerdictSet2: () => [...LIVE_VERDICT_SET_2],
	getVerdictSet4: () => [...LIVE_VERDICT_SET_4],
};

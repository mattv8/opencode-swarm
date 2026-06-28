/**
 * Unit tests for src/evidence/normalize-verdict.ts
 *
 * Verifies both the 2-value (drift/hallucination) and 4-value (mutation)
 * normalization paths, plus the _internals DI seam.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	_internals,
	normalizeVerdict2,
	normalizeVerdict4,
} from '../../../src/evidence/normalize-verdict';
import { executeWriteDriftEvidence } from '../../../src/tools/write-drift-evidence';
import { executeWriteHallucinationEvidence } from '../../../src/tools/write-hallucination-evidence';
import { executeWriteMutationEvidence } from '../../../src/tools/write-mutation-evidence';

describe('normalizeVerdict2 (drift / hallucination)', () => {
	test('normalizes APPROVED to approved', () => {
		expect(normalizeVerdict2('APPROVED')).toBe('approved');
	});

	test('normalizes NEEDS_REVISION to rejected', () => {
		expect(normalizeVerdict2('NEEDS_REVISION')).toBe('rejected');
	});

	test('throws on invalid verdict', () => {
		expect(() => normalizeVerdict2('INVALID')).toThrow(
			"Invalid verdict: must be 'APPROVED' or 'NEEDS_REVISION', got 'INVALID'",
		);
	});

	test('throws on empty string', () => {
		expect(() => normalizeVerdict2('')).toThrow(
			"Invalid verdict: must be 'APPROVED' or 'NEEDS_REVISION', got ''",
		);
	});

	test('is case-sensitive — lower-case approved is rejected', () => {
		expect(() => normalizeVerdict2('approved')).toThrow();
	});
});

describe('normalizeVerdict4 (mutation)', () => {
	test('normalizes PASS to pass', () => {
		expect(normalizeVerdict4('PASS')).toBe('pass');
	});

	test('normalizes WARN to warn', () => {
		expect(normalizeVerdict4('WARN')).toBe('warn');
	});

	test('normalizes FAIL to fail', () => {
		expect(normalizeVerdict4('FAIL')).toBe('fail');
	});

	test('normalizes SKIP to skip', () => {
		expect(normalizeVerdict4('SKIP')).toBe('skip');
	});

	test('throws on invalid verdict', () => {
		expect(() => normalizeVerdict4('INVALID')).toThrow(
			"Invalid verdict: must be 'PASS', 'WARN', 'FAIL', or 'SKIP', got 'INVALID'",
		);
	});

	test('throws on empty string', () => {
		expect(() => normalizeVerdict4('')).toThrow(
			"Invalid verdict: must be 'PASS', 'WARN', 'FAIL', or 'SKIP', got ''",
		);
	});

	test('is case-sensitive — lower-case pass is rejected', () => {
		expect(() => normalizeVerdict4('pass')).toThrow();
	});
});

describe('_internals DI seam', () => {
	let saved2: typeof normalizeVerdict2;
	let saved4: typeof normalizeVerdict4;

	beforeEach(() => {
		saved2 = _internals.normalizeVerdict2;
		saved4 = _internals.normalizeVerdict4;
	});

	afterEach(() => {
		_internals.normalizeVerdict2 = saved2;
		_internals.normalizeVerdict4 = saved4;
	});

	test('_internals.normalizeVerdict2 matches exported function by default', () => {
		expect(_internals.normalizeVerdict2).toBe(normalizeVerdict2);
	});

	test('_internals.normalizeVerdict4 matches exported function by default', () => {
		expect(_internals.normalizeVerdict4).toBe(normalizeVerdict4);
	});

	test('swapping _internals.normalizeVerdict2 affects consumers that reference _internals', () => {
		const consumer = (v: string) => _internals.normalizeVerdict2(v);
		_internals.normalizeVerdict2 = () => 'approved';
		expect(consumer('NEEDS_REVISION')).toBe('approved');
	});

	test('swapping _internals.normalizeVerdict4 affects consumers that reference _internals', () => {
		const consumer = (v: string) => _internals.normalizeVerdict4(v);
		_internals.normalizeVerdict4 = () => 'pass';
		expect(consumer('FAIL')).toBe('pass');
	});

	test('restoring _internals returns original behavior', () => {
		_internals.normalizeVerdict2 = () => 'approved' as 'approved' | 'rejected';
		_internals.normalizeVerdict2 = saved2;
		expect(normalizeVerdict2('NEEDS_REVISION')).toBe('rejected');
	});

	test('VERDICT_SET_2 and isAcceptedVerdict2 are live via _internals for propagation', () => {
		// Simulate adding a new verdict in the shared module (regression for AC-011/SC-016)
		const originalSet = [..._internals.VERDICT_SET_2];
		(_internals.VERDICT_SET_2 as string[]).push('NEEDS_DISCUSSION');
		try {
			expect(_internals.isAcceptedVerdict2('NEEDS_DISCUSSION')).toBe(true);
			expect(_internals.isAcceptedVerdict2('APPROVED')).toBe(true);
			expect(_internals.isAcceptedVerdict2('UNKNOWN')).toBe(false);
		} finally {
			(_internals.VERDICT_SET_2 as string[]).length = 0;
			(_internals.VERDICT_SET_2 as string[]).push(...originalSet);
		}
	});

	test('VERDICT_SET_4 and isAcceptedVerdict4 are live via _internals for propagation', () => {
		const originalSet = [..._internals.VERDICT_SET_4];
		(_internals.VERDICT_SET_4 as string[]).push('RETRY');
		try {
			expect(_internals.isAcceptedVerdict4('RETRY')).toBe(true);
			expect(_internals.isAcceptedVerdict4('PASS')).toBe(true);
			expect(_internals.isAcceptedVerdict4('UNKNOWN')).toBe(false);
		} finally {
			(_internals.VERDICT_SET_4 as string[]).length = 0;
			(_internals.VERDICT_SET_4 as string[]).push(...originalSet);
		}
	});
});

describe('regression: new verdict in shared module propagates to all writers (AC-011/SC-016)', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(
			path.join(os.tmpdir(), 'verdict-propagation-'),
		);
		await fs.promises.mkdir(path.join(tempDir, '.swarm'), { recursive: true });
	});

	afterEach(async () => {
		try {
			await fs.promises.rm(tempDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	test('AC-011/SC-016: setVerdictSet2 on shared module makes drift and hallucination writers accept NEEDS_DISCUSSION with no writer-local edits', async () => {
		const original = _internals.getVerdictSet2();
		_internals.setVerdictSet2([
			'APPROVED',
			'NEEDS_REVISION',
			'NEEDS_DISCUSSION',
		]);
		try {
			// Drift writer: only shared module touched
			const drift = await executeWriteDriftEvidence(
				{ phase: 1, verdict: 'NEEDS_DISCUSSION' as any, summary: 'discuss' },
				tempDir,
			);
			const driftJson = JSON.parse(drift);
			expect(driftJson.success).toBe(true);
			expect(driftJson.verdict).toBe('needs_discussion');

			// Hallucination writer: only shared module touched
			const hall = await executeWriteHallucinationEvidence(
				{ phase: 1, verdict: 'NEEDS_DISCUSSION' as any, summary: 'discuss' },
				tempDir,
			);
			const hallJson = JSON.parse(hall);
			expect(hallJson.success).toBe(true);
			expect(hallJson.verdict).toBe('needs_discussion');
		} finally {
			_internals.setVerdictSet2(original);
		}
	});

	test('AC-011/SC-016: setVerdictSet4 on shared module makes mutation writer accept RETRY with no writer-local edits', async () => {
		const original = _internals.getVerdictSet4();
		_internals.setVerdictSet4(['PASS', 'WARN', 'FAIL', 'SKIP', 'RETRY']);
		try {
			const mut = await executeWriteMutationEvidence(
				{ phase: 1, verdict: 'RETRY' as any, summary: 'retry later' },
				tempDir,
			);
			const mutJson = JSON.parse(mut);
			expect(mutJson.success).toBe(true);
			expect(mutJson.verdict).toBe('retry');
		} finally {
			_internals.setVerdictSet4(original);
		}
	});
});

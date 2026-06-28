/**
 * Unit tests for src/services/injection-budget.ts (FR-002).
 *
 * Verifies the pure allocation function that caps combined system-enhancer +
 * knowledge-injector output per turn against a unified budget ceiling.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
	allocateInjectionBudget,
	clearUnifiedBudget,
	ensureSessionBudget,
	getSystemEnhancerDemand,
	getUnifiedBudgetRemaining,
	getUnifiedBudgetTotal,
	type InjectionBudgetAllocation,
	type InjectionBudgetConfig,
	requestUnifiedBudget,
	resetUnifiedBudget,
	setSystemEnhancerDemand,
} from '../../../src/services/injection-budget.js';

describe('Unified Injection Budget (FR-002) — pure allocation service', () => {
	const DEFAULT_BUDGET = 4000;

	function allocate(
		systemEnhancerTokens: number,
		knowledgeInjectorChars: number,
		budget = DEFAULT_BUDGET,
	): InjectionBudgetAllocation {
		const config: InjectionBudgetConfig = { totalBudgetTokens: budget };
		return allocateInjectionBudget(
			systemEnhancerTokens,
			knowledgeInjectorChars,
			config,
		);
	}

	describe('AC-004: config key presence', () => {
		it('accepts totalBudgetTokens via InjectionBudgetConfig', () => {
			const config: InjectionBudgetConfig = { totalBudgetTokens: 4000 };
			expect(config.totalBudgetTokens).toBe(4000);
		});
	});

	describe('SC-004: combined demand within budget', () => {
		it('systemEnhancer=3K tokens + knowledgeInjector=2K chars within 4K budget → total ≤ 4K', () => {
			const result = allocate(3000, 2000, 4000);
			expect(result.totalTokens).toBeLessThanOrEqual(4000);
			// With 0.33 ratio, 2000 chars → Math.ceil(2000 * 0.33) = 660 tokens
			expect(result.systemEnhancerTokens).toBe(3000);
			expect(result.knowledgeInjectorTokens).toBe(660);
			expect(result.totalTokens).toBe(3660);
		});
	});

	describe('SC-005: single-component overrun → other gets zero', () => {
		it('systemEnhancer=10K, knowledgeInjector=0, totalBudget=4K → knowledgeInjector allocation = 0', () => {
			const result = allocate(10000, 0, 4000);
			expect(result.systemEnhancerTokens).toBe(4000);
			expect(result.knowledgeInjectorTokens).toBe(0);
			expect(result.totalTokens).toBe(4000);
		});

		it('knowledgeInjector demand alone exceeds budget → systemEnhancer gets 0', () => {
			// 20000 chars * 0.33 ≈ 6600 tokens > 4000 budget
			const result = allocate(0, 20000, 4000);
			expect(result.systemEnhancerTokens).toBe(0);
			expect(result.knowledgeInjectorTokens).toBe(4000);
			expect(result.totalTokens).toBe(4000);
		});
	});

	describe('SC-006: ceiling equals configured value', () => {
		it('when combined demand equals budget, allocations sum to exactly the budget', () => {
			// 3000 tokens + 3030 chars (≈ 1000 tokens) = 4000 total demand = budget
			const result = allocate(3000, 3030, 4000);
			expect(result.totalTokens).toBe(4000);
			expect(result.systemEnhancerTokens).toBe(3000);
			expect(result.knowledgeInjectorTokens).toBe(1000);
		});

		it('proportional split when combined demand exceeds budget but neither alone does', () => {
			// 3000 tokens + 4000 chars (≈ 1320 tokens) = 4320 > 4000
			// Proportional: 3000/4320 * 4000 = 2777 (floor), remainder to knowledge-injector
			const result = allocate(3000, 4000, 4000);
			expect(result.totalTokens).toBe(4000);
			expect(result.systemEnhancerTokens).toBeGreaterThan(0);
			expect(result.knowledgeInjectorTokens).toBeGreaterThan(0);
			expect(result.systemEnhancerTokens + result.knowledgeInjectorTokens).toBe(
				4000,
			);
		});
	});

	describe('edge cases', () => {
		it('zero budget yields zero allocations', () => {
			const result = allocate(3000, 2000, 0);
			expect(result.systemEnhancerTokens).toBe(0);
			expect(result.knowledgeInjectorTokens).toBe(0);
			expect(result.totalTokens).toBe(0);
		});

		it('zero demands yield zero allocations', () => {
			const result = allocate(0, 0, 4000);
			expect(result.systemEnhancerTokens).toBe(0);
			expect(result.knowledgeInjectorTokens).toBe(0);
			expect(result.totalTokens).toBe(0);
		});

		it('negative inputs are clamped to zero', () => {
			const result = allocate(-100, -500, 4000);
			expect(result.systemEnhancerTokens).toBe(0);
			expect(result.knowledgeInjectorTokens).toBe(0);
			expect(result.totalTokens).toBe(0);
		});
	});
});

describe('Stateful session-ledger helpers', () => {
	const SESSION_A = 'session-a';
	const SESSION_B = 'session-b';

	afterEach(() => {
		// Clean up both sessions after each test to prevent cross-test pollution.
		clearUnifiedBudget(SESSION_A);
		clearUnifiedBudget(SESSION_B);
	});

	describe('resetUnifiedBudget', () => {
		it('initializes a fresh budget entry for the session', () => {
			resetUnifiedBudget(SESSION_A, 5000);
			expect(getUnifiedBudgetTotal(SESSION_A)).toBe(5000);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(5000);
		});

		it('overwrites an existing budget entry', () => {
			resetUnifiedBudget(SESSION_A, 5000);
			requestUnifiedBudget(SESSION_A, 2000); // use 2000
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(3000);
			resetUnifiedBudget(SESSION_A, 8000); // reset to new total
			expect(getUnifiedBudgetTotal(SESSION_A)).toBe(8000);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(8000); // used is reset to 0
		});

		it('creates independent entries for different sessions', () => {
			resetUnifiedBudget(SESSION_A, 5000);
			resetUnifiedBudget(SESSION_B, 3000);
			expect(getUnifiedBudgetTotal(SESSION_A)).toBe(5000);
			expect(getUnifiedBudgetTotal(SESSION_B)).toBe(3000);
		});
	});

	describe('getUnifiedBudgetRemaining', () => {
		it('returns 0 for an unknown session', () => {
			expect(getUnifiedBudgetRemaining('unknown-session')).toBe(0);
		});

		it('returns total minus used after requests', () => {
			resetUnifiedBudget(SESSION_A, 4000);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(4000);
			requestUnifiedBudget(SESSION_A, 1500);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(2500);
			requestUnifiedBudget(SESSION_A, 2000);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(500);
		});

		it('returns 0 when budget is fully exhausted', () => {
			resetUnifiedBudget(SESSION_A, 1000);
			requestUnifiedBudget(SESSION_A, 1000);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(0);
		});
	});

	describe('requestUnifiedBudget', () => {
		it('grants the full request when budget is sufficient', () => {
			resetUnifiedBudget(SESSION_A, 4000);
			const granted = requestUnifiedBudget(SESSION_A, 2000);
			expect(granted).toBe(2000);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(2000);
		});

		it('grants only the remaining budget when request exceeds remaining', () => {
			resetUnifiedBudget(SESSION_A, 1000);
			const granted = requestUnifiedBudget(SESSION_A, 1500);
			expect(granted).toBe(1000);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(0);
		});

		it('fails open (returns full request) when no budget entry exists', () => {
			const granted = requestUnifiedBudget('no-such-session', 500);
			expect(granted).toBe(500);
		});

		it('multiple sequential requests correctly track used amount', () => {
			resetUnifiedBudget(SESSION_A, 3000);
			const r1 = requestUnifiedBudget(SESSION_A, 1000);
			const r2 = requestUnifiedBudget(SESSION_A, 1500);
			const r3 = requestUnifiedBudget(SESSION_A, 2000);
			expect(r1).toBe(1000);
			expect(r2).toBe(1500);
			expect(r3).toBe(500); // only 500 remaining
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(0);
		});
	});

	describe('getUnifiedBudgetTotal', () => {
		it('returns 0 for an unknown session', () => {
			expect(getUnifiedBudgetTotal('unknown-session')).toBe(0);
		});

		it('returns the configured total for an existing session', () => {
			resetUnifiedBudget(SESSION_A, 6000);
			expect(getUnifiedBudgetTotal(SESSION_A)).toBe(6000);
		});
	});

	describe('clearUnifiedBudget', () => {
		it('removes the session entry', () => {
			resetUnifiedBudget(SESSION_A, 5000);
			clearUnifiedBudget(SESSION_A);
			expect(getUnifiedBudgetTotal(SESSION_A)).toBe(0);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(0);
		});

		it('is idempotent (deleting twice does not throw)', () => {
			resetUnifiedBudget(SESSION_A, 5000);
			clearUnifiedBudget(SESSION_A);
			expect(() => clearUnifiedBudget(SESSION_A)).not.toThrow();
		});
	});

	describe('ensureSessionBudget', () => {
		it('creates a budget entry if none exists', () => {
			ensureSessionBudget(SESSION_A, 7000);
			expect(getUnifiedBudgetTotal(SESSION_A)).toBe(7000);
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(7000);
		});

		it('leaves an existing entry untouched', () => {
			resetUnifiedBudget(SESSION_A, 5000);
			requestUnifiedBudget(SESSION_A, 2000);
			ensureSessionBudget(SESSION_A, 8000); // should NOT reset used
			expect(getUnifiedBudgetTotal(SESSION_A)).toBe(5000); // unchanged
			expect(getUnifiedBudgetRemaining(SESSION_A)).toBe(3000); // unchanged
		});
	});

	describe('setSystemEnhancerDemand / getSystemEnhancerDemand', () => {
		it('stores and retrieves system-enhancer demand for a session', () => {
			resetUnifiedBudget(SESSION_A, 4000);
			setSystemEnhancerDemand(SESSION_A, 2500);
			expect(getSystemEnhancerDemand(SESSION_A)).toBe(2500);
		});

		it('returns 0 for an unknown session', () => {
			expect(getSystemEnhancerDemand('unknown-session')).toBe(0);
		});

		it('returns 0 when no demand was set for an existing session', () => {
			resetUnifiedBudget(SESSION_A, 4000);
			expect(getSystemEnhancerDemand(SESSION_A)).toBe(0);
		});

		it('overwrites a previously set demand', () => {
			resetUnifiedBudget(SESSION_A, 4000);
			setSystemEnhancerDemand(SESSION_A, 1000);
			setSystemEnhancerDemand(SESSION_A, 3000);
			expect(getSystemEnhancerDemand(SESSION_A)).toBe(3000);
		});

		it('does nothing when no budget entry exists for the session', () => {
			// Should not throw; demand is silently dropped
			expect(() =>
				setSystemEnhancerDemand('no-such-session', 500),
			).not.toThrow();
			expect(getSystemEnhancerDemand('no-such-session')).toBe(0);
		});

		it('independent sessions have independent demand tracking', () => {
			resetUnifiedBudget(SESSION_A, 4000);
			resetUnifiedBudget(SESSION_B, 4000);
			setSystemEnhancerDemand(SESSION_A, 3000);
			setSystemEnhancerDemand(SESSION_B, 1500);
			expect(getSystemEnhancerDemand(SESSION_A)).toBe(3000);
			expect(getSystemEnhancerDemand(SESSION_B)).toBe(1500);
		});
	});
});

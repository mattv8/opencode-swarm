/**
 * Regression coverage for mirrored on-demand skills.
 */

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	ADAPTER_ARCHITECT_MODE_SKILLS,
	DIVERGENT_ARCHITECT_MODE_SKILLS,
	MIRRORED_ARCHITECT_MODE_SKILLS,
	OPENCODE_ONLY_ARCHITECT_MODE_SKILLS,
} from '../../../src/config/skill-mirrors.ts';

// The mirror contract lists now live in src/config/skill-mirrors.ts so the
// regression test below and the scripts/drift-check.ts CI detector share one
// source of truth and cannot themselves drift apart. When adding a new
// architect mode stub that loads a skill, update that module (MIRRORED, or
// DIVERGENT if the .claude variant is intentionally condensed).
const architectSource = readFileSync(
	join(process.cwd(), 'src/agents/architect.ts'),
	'utf-8',
);

describe('architect mode skill mirrors - regression: prevent mirror drift (F-001)', () => {
	for (const [
		skillName,
		opencodePath,
		claudePath,
	] of MIRRORED_ARCHITECT_MODE_SKILLS) {
		it(`${skillName} skill stays byte-identical across OpenCode and Claude mirrors`, () => {
			// Future protocol edits must update both mirrors together; otherwise
			// OpenCode and Claude sessions can diverge silently.
			const opencodeSkill = readFileSync(
				join(process.cwd(), opencodePath),
				'utf-8',
			);
			const claudeSkill = readFileSync(
				join(process.cwd(), claudePath),
				'utf-8',
			);

			expect(claudeSkill).toBe(opencodeSkill);
		});
	}

	for (const {
		slug,
		opencodePath,
		claudePath,
		reason,
	} of DIVERGENT_ARCHITECT_MODE_SKILLS) {
		it(`${slug} skill: both .opencode and .claude mirrors exist (${reason})`, () => {
			expect(existsSync(join(process.cwd(), opencodePath))).toBe(true);
			expect(existsSync(join(process.cwd(), claudePath))).toBe(true);
		});
	}

	for (const {
		slug,
		canonicalPath,
		adapterPaths,
		expectedCanonicalRef,
	} of ADAPTER_ARCHITECT_MODE_SKILLS) {
		it(`${slug} adapters delegate back to the canonical .opencode skill`, () => {
			expect(existsSync(join(process.cwd(), canonicalPath))).toBe(true);

			for (const adapterPath of adapterPaths) {
				const adapterSource = readFileSync(
					join(process.cwd(), adapterPath),
					'utf-8',
				);
				const lineCount = adapterSource.trimEnd().split(/\r?\n/).length;

				expect(adapterSource).toContain(expectedCanonicalRef);
				expect(lineCount).toBeLessThan(60);
				expect(adapterSource).toContain('canonical workflow');
				expect(adapterSource).not.toContain('## Phase ');
				expect(adapterSource).not.toContain('## Multi-Round');
				expect(adapterSource).not.toContain('### Bot Review');
			}
		});
	}

	for (const {
		slug,
		opencodePath,
		reason,
	} of OPENCODE_ONLY_ARCHITECT_MODE_SKILLS) {
		it(`${slug} skill: .opencode exists and is intentionally NOT mirrored to .claude (${reason})`, () => {
			expect(existsSync(join(process.cwd(), opencodePath))).toBe(true);
			const claudePath = opencodePath.replace(
				'.opencode/skills/',
				'.claude/skills/',
			);
			expect(existsSync(join(process.cwd(), claudePath))).toBe(false);
		});
	}

	it('keeps mirrored skill list in sync with architect mode stubs', () => {
		// Previous coverage used only this hardcoded list, so a new architect
		// stub could reference a skill that was never checked for mirror parity.
		const stubSlugs = [
			...architectSource.matchAll(
				/file:\.opencode\/skills\/([^/\s`]+)\/SKILL\.md/g,
			),
		].map((match) => match[1]);
		const mirroredSlugs = [
			...MIRRORED_ARCHITECT_MODE_SKILLS.map(([skillName]) => skillName),
			...DIVERGENT_ARCHITECT_MODE_SKILLS.map(({ slug }) => slug),
			...ADAPTER_ARCHITECT_MODE_SKILLS.map(({ slug }) => slug),
			...OPENCODE_ONLY_ARCHITECT_MODE_SKILLS.map(({ slug }) => slug),
		];

		// Deduplicate both sides — architect.ts may reference a slug in multiple
		// MODE stubs (e.g. when the same skill is loaded by two modes), and a
		// future editor could mistakenly add a slug to both MIRRORED and DIVERGENT.
		expect([...new Set(stubSlugs)].sort()).toEqual(
			[...new Set(mirroredSlugs)].sort(),
		);
	});
});

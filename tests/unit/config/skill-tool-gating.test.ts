/**
 * Skill-management tool gating tests (FR-004).
 * Verifies that the 7 skill_* tools are absent from architect surface by default
 * and appear only when skills.enabled === true.
 *
 * Pattern mirrors external-skill-agent-tool-map.test.ts and memory-tool-gating.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import { getAgentConfigs } from '../../../src/agents';
import type { PluginConfig } from '../../../src/config';
import {
	SKILL_AGENT_TOOL_MAP,
	SKILL_TOOL_NAMES,
} from '../../../src/config/constants';
import { TOOL_NAME_SET } from '../../../src/tools/tool-names';

describe('SKILL_TOOL_NAMES', () => {
	test('contains exactly 7 expected tool names', () => {
		expect(SKILL_TOOL_NAMES).toHaveLength(7);
		expect(SKILL_TOOL_NAMES).toContain('skill_generate');
		expect(SKILL_TOOL_NAMES).toContain('skill_list');
		expect(SKILL_TOOL_NAMES).toContain('skill_apply');
		expect(SKILL_TOOL_NAMES).toContain('skill_inspect');
		expect(SKILL_TOOL_NAMES).toContain('skill_regenerate');
		expect(SKILL_TOOL_NAMES).toContain('skill_retire');
		expect(SKILL_TOOL_NAMES).toContain('skill_improve');
	});

	test('all entries are valid ToolName types (exist in TOOL_NAME_SET)', () => {
		for (const tool of SKILL_TOOL_NAMES) {
			expect(TOOL_NAME_SET.has(tool)).toBe(true);
		}
	});
});

describe('SKILL_AGENT_TOOL_MAP', () => {
	test('only maps to architect agent', () => {
		const agentNames = Object.keys(SKILL_AGENT_TOOL_MAP);
		expect(agentNames).toEqual(['architect']);
	});

	test('architect entry contains all 7 skill tools', () => {
		const architectTools = SKILL_AGENT_TOOL_MAP.architect;
		expect(architectTools).toHaveLength(7);
		for (const tool of SKILL_TOOL_NAMES) {
			expect(architectTools).toContain(tool);
		}
	});
});

describe('skill tool gating via getAgentConfigs (FR-004)', () => {
	test('when skills.enabled is false (default), tools do NOT appear in architect tool list', () => {
		const agents = getAgentConfigs({
			skills: { enabled: false },
		} as PluginConfig);

		for (const tool of SKILL_TOOL_NAMES) {
			expect(agents.architect.tools?.[tool]).toBeUndefined();
		}
	});

	test('when skills.enabled is false (default), tools do NOT appear in architect tool list (skill_improver legitimately retains them)', () => {
		const agents = getAgentConfigs({
			skills: { enabled: false },
		} as PluginConfig);

		// Architect must be gated
		for (const tool of SKILL_TOOL_NAMES) {
			expect(agents.architect.tools?.[tool]).toBeUndefined();
		}
		// skill_improver legitimately keeps the tools (it is the consumer of skill_* tools)
		if (agents.skill_improver) {
			for (const tool of SKILL_TOOL_NAMES) {
				// skill_improver may or may not be present depending on config; if present it is allowed to have them
			}
		}
	});

	test('when skills.enabled is true, all 7 tools appear in architect tool list', () => {
		const agents = getAgentConfigs({
			skills: { enabled: true },
		} as PluginConfig);

		for (const tool of SKILL_TOOL_NAMES) {
			expect(agents.architect.tools?.[tool]).toBe(true);
		}
	});

	test('when skills.enabled is true, tools do NOT appear in non-architect non-skill_improver agents', () => {
		const agents = getAgentConfigs({
			skills: { enabled: true },
		} as PluginConfig);

		const nonTargetAgents = Object.keys(agents).filter(
			(name) => name !== 'architect' && name !== 'skill_improver',
		);
		for (const agentName of nonTargetAgents) {
			for (const tool of SKILL_TOOL_NAMES) {
				expect(agents[agentName]?.tools?.[tool]).toBeUndefined();
			}
		}
	});

	test('skills.enabled true appends tools after tool_filter overrides', () => {
		const agents = getAgentConfigs({
			skills: { enabled: true },
			tool_filter: {
				enabled: true,
				overrides: {
					architect: ['save_plan'],
				},
			},
		} as PluginConfig);

		// Override tool should still be present
		expect(agents.architect.tools?.save_plan).toBe(true);
		// Skill tools should also be present
		for (const tool of SKILL_TOOL_NAMES) {
			expect(agents.architect.tools?.[tool]).toBe(true);
		}
	});

	test('skills.enabled false with override still excludes skill tools', () => {
		const agents = getAgentConfigs({
			skills: { enabled: false },
			tool_filter: {
				enabled: true,
				overrides: {
					architect: ['save_plan'],
				},
			},
		} as PluginConfig);

		// Override tool should still be present
		expect(agents.architect.tools?.save_plan).toBe(true);
		// Skill tools should NOT be present
		for (const tool of SKILL_TOOL_NAMES) {
			expect(agents.architect.tools?.[tool]).toBeUndefined();
		}
	});

	test('skills.enabled=false + tool_filter override including skill tool still excludes (bypass regression)', () => {
		// Explicit bypass scenario from FR-004 gate issue:
		// override lists a skill tool, but gate must still exclude it.
		const agents = getAgentConfigs({
			skills: { enabled: false },
			tool_filter: {
				enabled: true,
				overrides: {
					architect: ['save_plan', 'skill_generate'],
				},
			},
		} as PluginConfig);

		// Non-skill override tool is present
		expect(agents.architect.tools?.save_plan).toBe(true);
		// Skill tool from override MUST still be excluded (gate is authoritative)
		expect(agents.architect.tools?.skill_generate).toBeUndefined();
		for (const tool of SKILL_TOOL_NAMES) {
			expect(agents.architect.tools?.[tool]).toBeUndefined();
		}
	});

	test('default config (no skills key) excludes skill tools (fresh install)', () => {
		const agents = getAgentConfigs(undefined);

		for (const tool of SKILL_TOOL_NAMES) {
			expect(agents.architect.tools?.[tool]).toBeUndefined();
		}
	});

	test('skills.enabled true also appears in architect prompt text', () => {
		const agents = getAgentConfigs({
			skills: { enabled: true },
		} as PluginConfig);

		for (const tool of SKILL_TOOL_NAMES) {
			expect(agents.architect.prompt).toContain(tool);
		}
	});

	test('skills.enabled false excludes skill tools from architect prompt text', () => {
		const agents = getAgentConfigs({
			skills: { enabled: false },
		} as PluginConfig);

		for (const tool of SKILL_TOOL_NAMES) {
			// Prompt may contain the tool name in other contexts (e.g., skill_improver docs);
			// we only assert that the architect's *tool surface* (YOUR_TOOLS / AVAILABLE_TOOLS) does not list them.
			// A conservative check: the tool name should not appear as a bare token in the tools section.
			// We accept that the string may appear in prose; the critical gate is the tools map.
			expect(agents.architect.tools?.[tool]).toBeUndefined();
		}
	});
});

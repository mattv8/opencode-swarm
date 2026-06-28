import { beforeEach, describe, expect, test } from 'bun:test';
import * as os from 'node:os';
import type { GuardrailsConfig } from '../../../src/config/schema';
import { createGuardrailsHooks } from '../../../src/hooks/guardrails';
import {
	dcNormalizeCommand,
	dcSplitSegments,
	dcUnwrapWrappers,
	dcValidateTargets,
} from '../../../src/hooks/guardrails/destructive-command';
import { resetSwarmState, startAgentSession } from '../../../src/state';

const DEFAULT_SEED = 0x5eeddc01;
const DEFAULT_ITERATIONS = 200;
const MAX_ITERATIONS = 2000;

function envNumber(name: string, fallback: number): number {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fuzzSeed(): number {
	return envNumber('SWARM_SECURITY_FUZZ_SEED', DEFAULT_SEED);
}

function fuzzIterations(): number {
	return Math.min(
		envNumber('SWARM_SECURITY_FUZZ_ITERATIONS', DEFAULT_ITERATIONS),
		MAX_ITERATIONS,
	);
}

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rng: () => number, values: readonly T[]): T {
	return values[Math.floor(rng() * values.length)];
}

function defaultConfig(): GuardrailsConfig {
	return {
		enabled: true,
		max_tool_calls: 200,
		max_duration_minutes: 30,
		idle_timeout_minutes: 60,
		max_repetitions: 10,
		max_consecutive_errors: 5,
		warning_threshold: 0.75,
		profiles: undefined,
		block_destructive_commands: true,
	};
}

function makeBashInput(sessionID = 'property-session') {
	return { tool: 'bash', sessionID, callID: 'call-1' };
}

function makeBashOutput(command: string) {
	return { args: { command } };
}

const DESTRUCTIVE_CORPUS = [
	'rm -rf /',
	'rm -r -f /',
	'rm --recursive --force /',
	'sudo rm -rf /home/user',
	'cmd /c rmdir /s /q C:\\Users\\Brett',
	'powershell -Command "Remove-Item -Recurse -Force C:\\Windows"',
	'bash -c "rm -rf .swarm"',
	'sh -c "rm -rf $HOME"',
	'ｒｍ -ｒｆ /',
	'git reset --hard HEAD~1',
	'docker system prune -af',
	'kubectl delete pod app',
	':(){ :|:& };:',
];

const TARGET_CORPUS = [
	'/',
	'/home/user',
	'/Users/brett',
	'/etc',
	'C:\\Users\\Brett',
	'C:\\Windows',
	'$HOME',
	'${PROJECT_ROOT}',
	'%USERPROFILE%',
	'\\\\server\\share',
	'node_modules',
	'dist',
	'.swarm',
];

function mutateCommand(command: string, rng: () => number): string {
	switch (Math.floor(rng() * 5)) {
		case 0:
			return command.replaceAll(' ', pick(rng, ['  ', '\t', ' \t ']));
		case 1:
			return `bash -c "${command.replaceAll('"', '\\"')}"`;
		case 2:
			return `cmd /c "${command.replaceAll('"', '\\"')}"`;
		case 3:
			return `${command}; echo done`;
		default:
			return command;
	}
}

describe('destructive command property coverage', () => {
	beforeEach(() => {
		resetSwarmState();
		startAgentSession('property-session', 'coder');
	});

	test('normalization, wrapper unwrapping, splitting, and target validation do not throw', () => {
		const rng = mulberry32(fuzzSeed());
		for (let i = 0; i < fuzzIterations(); i++) {
			const command = mutateCommand(pick(rng, DESTRUCTIVE_CORPUS), rng);
			expect(() => {
				const normalized = dcNormalizeCommand(command);
				const unwrapped = dcUnwrapWrappers(normalized);
				for (const segment of dcSplitSegments(unwrapped)) {
					dcValidateTargets([pick(rng, TARGET_CORPUS)], os.tmpdir());
					dcValidateTargets([segment], os.tmpdir());
				}
			}).not.toThrow();
		}
	});

	test.each([
		'rm -rf /',
		'rm -r -f /',
		'rm -fr /home/user',
		'rm --recursive --force /',
		'rm -rf --no-preserve-root /',
		'rm -rf /home/user',
		'rm -rf .swarm',
		'cmd /c rmdir /s /q C:\\Users\\Brett',
		'powershell -Command "Remove-Item -Recurse -Force C:\\Windows"',
	])('integrated guard blocks destructive target %s', async (command) => {
		const hooks = createGuardrailsHooks(
			os.tmpdir(),
			undefined,
			defaultConfig(),
		);
		await expect(
			hooks.toolBefore(makeBashInput(), makeBashOutput(command)),
		).rejects.toThrow(/BLOCKED/);
	});
});

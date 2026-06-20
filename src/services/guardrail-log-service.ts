import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { redactPath } from '../hooks/guardrails/audit-log.js';
import { redactShellCommand } from '../hooks/guardrails/helpers.js';

export interface GuardrailLogEntry {
	ts: string;
	type?: string;
	sessionID: string;
	agent: string;
	tool: string;
	command?: string;
	path?: string;
}

const BLOCK_TYPES = new Set<string>([
	'file_write',
	'scope_violation',
	'destructive_block',
]);

function isBlockEntry(entry: GuardrailLogEntry): boolean {
	if (entry.type === null || entry.type === undefined) return false;
	return BLOCK_TYPES.has(entry.type);
}

function redactSummary(entry: GuardrailLogEntry): string {
	if (entry.type === 'file_write' || entry.type === 'scope_violation') {
		const raw = entry.path ?? '';
		return redactPath(raw);
	}

	if (
		entry.type === 'destructive_block' ||
		entry.type === 'sandbox_wrap' ||
		entry.type === 'sandbox_skip' ||
		entry.type === 'shell' ||
		entry.type === null ||
		entry.type === undefined
	) {
		const raw = entry.command ?? '';
		return redactShellCommand(raw);
	}

	return '';
}

function formatEntry(entry: GuardrailLogEntry): string {
	const decisionType = entry.type ?? 'shell';
	const summary = redactSummary(entry);

	return `- [${entry.ts}] ${decisionType} | agent: ${entry.agent} | ${summary}`;
}

export async function handleGuardrailLog(
	directory: string,
	args: string[],
): Promise<string> {
	const auditPath = path.join(
		directory,
		'.swarm',
		'session',
		'shell-audit.jsonl',
	);

	let raw: string;
	try {
		raw = await fs.readFile(auditPath, 'utf-8');
	} catch (error) {
		if (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			(error as { code?: string }).code === 'ENOENT'
		) {
			return 'No guardrail decisions recorded yet.';
		}
		throw error;
	}

	const lines = raw.split(/\r?\n/);
	const entries: GuardrailLogEntry[] = [];

	for (const line of lines) {
		if (line.trim().length === 0) continue;

		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}

		if (!isPlainObject(parsed)) continue;
		if (typeof parsed.ts !== 'string') continue;
		if (typeof parsed.sessionID !== 'string') continue;
		if (typeof parsed.agent !== 'string') continue;
		if (typeof parsed.tool !== 'string') continue;

		const entry: GuardrailLogEntry = {
			ts: parsed.ts,
			sessionID: parsed.sessionID,
			agent: parsed.agent,
			tool: parsed.tool,
		};

		if (typeof parsed.type === 'string') {
			entry.type = parsed.type;
		}
		if (typeof parsed.command === 'string') {
			entry.command = parsed.command;
		}
		if (typeof parsed.path === 'string') {
			entry.path = parsed.path;
		}

		entries.push(entry);
	}

	if (entries.length === 0) {
		return 'No guardrail decisions recorded yet.';
	}

	const blocksOnly = args.includes('--blocks-only');

	const filtered = blocksOnly ? entries.filter(isBlockEntry) : entries;

	if (filtered.length === 0) {
		if (blocksOnly) {
			return 'No guardrail block decisions recorded yet.';
		}
		return 'No guardrail decisions recorded yet.';
	}

	filtered.sort((a, b) => {
		const diff = b.ts.localeCompare(a.ts);
		return diff === 0 ? 0 : diff;
	});

	const header = blocksOnly
		? '# Guardrail Block Log (most-recent-first)'
		: '# Guardrail Decision Log (most-recent-first)';

	const body = filtered.map(formatEntry).join('\n');

	return `${header}\n\n${body}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value.constructor === Object || Object.getPrototypeOf(value) === null)
	);
}

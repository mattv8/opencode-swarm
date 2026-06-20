/**
 * Unified Guardrail Decision Audit Log
 *
 * Additive JSONL schema for guardrail decisions. Each append writes one
 * validated JSON line to the configured audit path under `.swarm/session/`.
 *
 * The existing shell audit entry shape is preserved byte-for-byte when
 * `type: 'shell'` is used (fields: ts, sessionID, agent, tool, command).
 *
 * Path redaction: there is no cross-cutting path-redaction helper in this
 * module today. Callers MAY pass a pre-redacted path via `redactPath(...)`
 * before constructing the entry; the module itself does not mutate path
 * strings beyond normalizing separators. Future hardening: add a shared
 * path-redaction utility and call it here.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { log } from '../../utils/logger';
import { redactShellCommand } from './helpers';

// DI seam for testability — tests mock these function references directly (function mocks
// restore cleanly in afterEach) instead of mock.module('node:fs/promises'), which leaks
// across test files in Bun's shared test-runner process (AGENTS.md invariant 7).
export const _internals = {
	mkdir: fs.mkdir,
	appendFile: fs.appendFile,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Discriminated union of guardrail decision types.
 *
 * Invariants:
 * - `ts` is an ISO-8601 datetime string.
 * - `sessionID` is the swarm session identifier.
 * - `agent` is the role string (e.g. "architect", "coder").
 * - `tool` is the original tool name as invoked.
 */
export type GuardrailDecisionType =
	| 'shell'
	| 'file_write'
	| 'scope_violation'
	| 'destructive_block'
	| 'sandbox_wrap'
	| 'sandbox_skip';

export interface ShellDecision {
	type: 'shell';
	ts: string;
	sessionID: string;
	agent: string;
	tool: string;
	command: string;
}

export interface FileWriteDecision {
	type: 'file_write';
	ts: string;
	sessionID: string;
	agent: string;
	tool: string;
	path: string;
	reason: string;
	resolvedScope: string;
}

export interface ScopeViolationDecision {
	type: 'scope_violation';
	ts: string;
	sessionID: string;
	agent: string;
	tool: string;
	path: string;
	declaredScope: string;
	resolvedScope: string;
	action: string;
}

export interface DestructiveBlockDecision {
	type: 'destructive_block';
	ts: string;
	sessionID: string;
	agent: string;
	tool: string;
	command: string;
	destructiveCategory: string;
}

export interface SandboxWrapDecision {
	type: 'sandbox_wrap';
	ts: string;
	sessionID: string;
	agent: string;
	tool: string;
	command: string;
	executorMechanism: string;
}

export interface SandboxSkipDecision {
	type: 'sandbox_skip';
	ts: string;
	sessionID: string;
	agent: string;
	tool: string;
	command: string;
	executorMechanism: string;
	skipReason: string;
}

export type GuardrailDecisionEntry =
	| ShellDecision
	| FileWriteDecision
	| ScopeViolationDecision
	| DestructiveBlockDecision
	| SandboxWrapDecision
	| SandboxSkipDecision;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const REQUIRED_STRING_FIELDS = [
	'ts',
	'sessionID',
	'agent',
	'tool',
	'type',
] as const satisfies ReadonlyArray<keyof GuardrailDecisionEntry>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value.constructor === Object || Object.getPrototypeOf(value) === null)
	);
}

function validateEntry(entry: unknown): entry is GuardrailDecisionEntry {
	if (!isPlainObject(entry)) {
		log('guardrail audit: rejected non-object entry', entry);
		return false;
	}

	for (const field of REQUIRED_STRING_FIELDS) {
		if (typeof entry[field] !== 'string') {
			log('guardrail audit: rejected entry missing string field', {
				field,
				entry,
			});
			return false;
		}
	}

	const validTypes: GuardrailDecisionType[] = [
		'shell',
		'file_write',
		'scope_violation',
		'destructive_block',
		'sandbox_wrap',
		'sandbox_skip',
	];
	if (!validTypes.includes(entry.type as GuardrailDecisionType)) {
		log('guardrail audit: rejected entry with invalid type', {
			type: entry.type,
			entry,
		});
		return false;
	}

	// Per-type field validation: verify type-specific required fields are
	// present and are strings. Reject (return false, never throw) on failure.
	switch (entry.type) {
		case 'shell':
			// No extra fields beyond the shared set.
			break;
		case 'file_write': {
			const required = ['path', 'reason', 'resolvedScope'] as const;
			for (const field of required) {
				if (typeof entry[field] !== 'string') {
					log(
						'guardrail audit: rejected file_write entry missing string field',
						{ field, entry },
					);
					return false;
				}
			}
			break;
		}
		case 'scope_violation': {
			const required = [
				'path',
				'declaredScope',
				'resolvedScope',
				'action',
			] as const;
			for (const field of required) {
				if (typeof entry[field] !== 'string') {
					log(
						'guardrail audit: rejected scope_violation entry missing string field',
						{ field, entry },
					);
					return false;
				}
			}
			break;
		}
		case 'destructive_block': {
			const required = ['command', 'destructiveCategory'] as const;
			for (const field of required) {
				if (typeof entry[field] !== 'string') {
					log(
						'guardrail audit: rejected destructive_block entry missing string field',
						{ field, entry },
					);
					return false;
				}
			}
			break;
		}
		case 'sandbox_wrap': {
			const required = ['command', 'executorMechanism'] as const;
			for (const field of required) {
				if (typeof entry[field] !== 'string') {
					log(
						'guardrail audit: rejected sandbox_wrap entry missing string field',
						{ field, entry },
					);
					return false;
				}
			}
			break;
		}
		case 'sandbox_skip': {
			const required = ['command', 'executorMechanism', 'skipReason'] as const;
			for (const field of required) {
				if (typeof entry[field] !== 'string') {
					log(
						'guardrail audit: rejected sandbox_skip entry missing string field',
						{ field, entry },
					);
					return false;
				}
			}
			break;
		}
	}

	return true;
}

/**
 * Best-effort path redaction for audit logs.
 *
 * Replaces leading home/profile segments with a tilde placeholder so
 * absolute paths do not leak user-specific directory names.
 *
 * This is intentionally minimal — callers remain responsible for
 * stripping any domain-specific secrets that may appear in path segments.
 */
export function redactPath(filePath: string): string {
	if (typeof filePath !== 'string' || filePath.length === 0) return filePath;

	// POSIX home: /home/<name>/... -> ~/...
	const rawPosixHomeMatch = filePath.match(/^(\/home\/[^/]+)(\/.*)$/);
	if (rawPosixHomeMatch) {
		return `~${rawPosixHomeMatch[2]}`;
	}

	// macOS home: /Users/<name>/... -> ~/... (parity with redactShellCommand)
	const rawMacHomeMatch = filePath.match(/^(\/Users\/[^/]+)(\/.*)$/);
	if (rawMacHomeMatch) {
		return `~${rawMacHomeMatch[2]}`;
	}

	const normalized = path.normalize(filePath);

	// Windows user profile: C:\Users\<name>\... -> ~\<name>\...
	const windowsHomeMatch = normalized.match(
		/^([A-Za-z]:\\Users\\[^\\]+)(\\.*)$/,
	);
	if (windowsHomeMatch) {
		return `~\\${windowsHomeMatch[2]}`;
	}

	// Windows UNC profile/share path: \\server\share\user\... -> ~\share\user\...
	const uncHomeMatch = normalized.match(
		/^\\\\[^\\]+\\([^\\]+)\\([^\\]+)(\\.*)$/,
	);
	if (uncHomeMatch) {
		return `~\\${uncHomeMatch[1]}\\${uncHomeMatch[2]}${uncHomeMatch[3]}`;
	}

	return normalized;
}

function redactEmbeddedPaths(text: string): string {
	return text
		.replace(/\/home\/[^/\s]+(\/[^\s"'`)]*)?/g, (match) => redactPath(match))
		.replace(/\/Users\/[^/\s]+(\/[^\s"'`)]*)?/g, (match) => redactPath(match))
		.replace(/[A-Za-z]:\\Users\\[^\\\s]+(\\[^\s"'`)]*)?/g, (match) =>
			redactPath(match),
		)
		.replace(/\\\\[^\\\s]+\\[^\\\s]+\\[^\\\s]+(\\[^\s"'`)]*)?/g, (match) =>
			redactPath(match),
		);
}

// ---------------------------------------------------------------------------
// Append
// ---------------------------------------------------------------------------

export interface AppendGuardrailDecisionOptions {
	auditPath: string;
	enabled: boolean;
}

/**
 * Append a validated guardrail decision entry to the JSONL audit log.
 *
 * - Writes exactly one JSON line per call (`JSON.stringify(entry) + '\n'`).
 * - Skips silently when `enabled` is false.
 * - Skips malformed entries after debug logging; never throws.
 * - `.swarm/` containment is enforced by the caller-supplied `auditPath`.
 *
 * @param entry Decision entry to persist.
 * @param ctx Audit destination and enablement flag.
 */
export async function appendGuardrailDecision(
	entry: GuardrailDecisionEntry,
	ctx: AppendGuardrailDecisionOptions,
): Promise<void> {
	if (!ctx.enabled) return;
	if (!validateEntry(entry)) return;

	// Legacy shell entries persist as the exact 5-field shape
	// {ts, sessionID, agent, tool, command} with the `type` discriminator stripped.
	// Command-bearing variants redact the command; path-bearing variants redact the path.
	let line: string;
	switch (entry.type) {
		case 'shell':
			line = `${JSON.stringify({
				ts: entry.ts,
				sessionID: entry.sessionID,
				agent: entry.agent,
				tool: entry.tool,
				command: redactShellCommand(entry.command),
			})}\n`;
			break;
		case 'destructive_block':
		case 'sandbox_wrap':
		case 'sandbox_skip':
			line = `${JSON.stringify({
				...entry,
				command: redactShellCommand(entry.command),
			})}\n`;
			break;
		case 'file_write':
			line = `${JSON.stringify({
				...entry,
				path: redactPath(entry.path),
				reason: redactEmbeddedPaths(entry.reason),
				resolvedScope: redactPath(entry.resolvedScope),
			})}\n`;
			break;
		case 'scope_violation':
			line = `${JSON.stringify({
				...entry,
				path: redactPath(entry.path),
				declaredScope: redactPath(entry.declaredScope),
				resolvedScope: redactPath(entry.resolvedScope),
			})}\n`;
			break;
	}

	try {
		await _internals.mkdir(path.dirname(ctx.auditPath), { recursive: true });
		await _internals.appendFile(ctx.auditPath, line, 'utf-8');
	} catch (error) {
		// Audit failures must never block tool execution.
		log('guardrail audit: append failed', {
			auditPath: ctx.auditPath,
			error,
		});
	}
}

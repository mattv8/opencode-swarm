/**
 * Summarization engine for tool outputs.
 * Provides content type detection, summarization decision logic, and structured summary creation.
 */

/**
 * Hysteresis factor to prevent churn for outputs near the threshold.
 * An output must be 25% larger than the threshold to be summarized.
 */
export const HYSTERESIS_FACTOR = 1.25;

/**
 * Content type classification for tool outputs.
 */
type ContentType = 'json' | 'code' | 'text' | 'binary';

/**
 * Heuristic-based content type detection.
 * @param output - The tool output string to analyze
 * @param toolName - The name of the tool that produced the output
 * @returns The detected content type: 'json', 'code', 'text', or 'binary'
 */
export function detectContentType(
	output: string,
	toolName: string,
): ContentType {
	// Check for JSON first
	const trimmed = output.trim();
	if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			JSON.parse(trimmed);
			return 'json';
		} catch {
			// Not valid JSON, continue to other checks
		}
	}

	// Check if tool suggests code (read, cat, grep, bash)
	const codeToolNames = ['read', 'cat', 'grep', 'bash'];
	const lowerToolName = toolName.toLowerCase();
	const toolSegments = lowerToolName.split(/[.\-_/]/);
	if (codeToolNames.some((name) => toolSegments.includes(name))) {
		return 'code';
	}

	// Check for common code patterns
	const codePatterns = [
		'function ',
		'const ',
		'import ',
		'export ',
		'class ',
		'def ',
		'return ',
		'=>',
	];
	const startsWithShebang = trimmed.startsWith('#!');

	if (
		codePatterns.some((pattern) => output.includes(pattern)) ||
		startsWithShebang
	) {
		return 'code';
	}

	// Check for binary content (high ratio of non-printable characters)
	const sampleSize = Math.min(1000, output.length);
	let nonPrintableCount = 0;
	for (let i = 0; i < sampleSize; i++) {
		const charCode = output.charCodeAt(i);
		// Count chars with code < 32, excluding \n (10), \r (13), \t (9)
		if (charCode < 32 && charCode !== 9 && charCode !== 10 && charCode !== 13) {
			nonPrintableCount++;
		}
	}

	if (sampleSize > 0 && nonPrintableCount / sampleSize > 0.1) {
		return 'binary';
	}

	// Default to text
	return 'text';
}

/**
 * Determines whether output should be summarized based on size and hysteresis.
 * Uses hysteresis to prevent repeated summarization decisions for outputs near the threshold.
 * @param output - The tool output string to check
 * @param thresholdBytes - The threshold in bytes
 * @returns true if the output should be summarized
 */
export function shouldSummarize(
	output: string,
	thresholdBytes: number,
): boolean {
	const byteLength = Buffer.byteLength(output, 'utf8');
	return byteLength >= thresholdBytes * HYSTERESIS_FACTOR;
}

/**
 * Formats bytes into a human-readable string.
 * @param bytes - The number of bytes
 * @returns Formatted string (e.g., "20.5 KB", "1.2 MB")
 */
function formatBytes(bytes: number): string {
	const units = ['B', 'KB', 'MB', 'GB'];
	let unitIndex = 0;
	let size = bytes;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	// Format to 1 decimal place if not whole number
	const formatted = unitIndex === 0 ? size.toString() : size.toFixed(1);
	return `${formatted} ${units[unitIndex]}`;
}

/**
 * Infer a compact type signature for a JSON value.
 */
function jsonTypeSignature(value: unknown): string {
	if (value === null) return 'null';
	if (Array.isArray(value)) {
		const len = value.length;
		if (len === 0) return 'array<>';
		const first = value[0];
		return `array<${len}, ${jsonTypeSignature(first)}>`;
	}
	switch (typeof value) {
		case 'string':
			return 'string';
		case 'number':
			return Number.isInteger(value) ? 'number' : 'number(float)';
		case 'boolean':
			return 'boolean';
		case 'object':
			return 'object';
		default:
			return typeof value;
	}
}

/**
 * Build a structure-aware preview for a JSON object.
 * Shows ALL top-level keys with their type signatures (AC-008 / SC-012).
 */
function summarizeJsonObject(parsed: Record<string, unknown>): string {
	const keys = Object.keys(parsed);
	const parts = keys.map((key) => `${key}: ${jsonTypeSignature(parsed[key])}`);
	return `{ ${parts.join(', ')} }`;
}

/**
 * Build a structure-aware preview for a JSON array.
 */
function summarizeJsonArray(parsed: unknown[]): string {
	const len = parsed.length;
	if (len === 0) return '[ 0 items ]';
	const firstSig = jsonTypeSignature(parsed[0]);
	return `[ ${len} items, first: ${firstSig} ]`;
}

/**
 * Regex-based extractor for declaration signatures in code output.
 */
const DECLARATION_PATTERN =
	/(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+(\w+)/g;

/**
 * Extract declaration names from code text.
 */
function extractCodeSignatures(code: string): string[] {
	const signatures: string[] = [];
	for (const match of code.matchAll(DECLARATION_PATTERN)) {
		const name = match[1];
		if (name && !signatures.includes(name)) {
			signatures.push(name);
		}
	}
	return signatures;
}

/**
 * Build a preview for code output that includes declaration signatures.
 */
function summarizeCode(output: string): string {
	const signatures = extractCodeSignatures(output);
	const lines = output
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.slice(0, 5);

	if (signatures.length === 0) {
		return lines.join('\n');
	}

	const sigLine = `// declarations: ${signatures.join(', ')}`;
	const previewLines = [sigLine, ...lines];
	return previewLines.join('\n');
}

/**
 * Build a preview for plain text output (leading non-blank lines).
 */
function summarizeText(output: string, maxLines: number): string {
	const lines = output
		.split('\n')
		.filter((line) => line.trim().length > 0)
		.slice(0, maxLines);
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a structured summary string from tool output.
 * @param output - The full tool output string
 * @param toolName - The name of the tool that produced the output
 * @param summaryId - Unique identifier for this summary
 * @param maxSummaryChars - Maximum characters allowed for the preview
 * @returns Formatted summary string
 */
export function createSummary(
	output: string,
	toolName: string,
	summaryId: string,
	maxSummaryChars: number,
): string {
	const contentType = detectContentType(output, toolName);
	const lineCount = output.split('\n').length;
	const byteSize = Buffer.byteLength(output, 'utf8');
	const formattedSize = formatBytes(byteSize);

	// Calculate overhead for header and footer lines
	const headerLine = `[SUMMARY ${summaryId}] ${formattedSize} | ${contentType} | ${lineCount} lines`;
	const footerLine = `→ Use /swarm retrieve ${summaryId} for full content`;
	const overhead = headerLine.length + 1 + footerLine.length + 1; // +1 for newline each

	const maxPreviewChars = maxSummaryChars - overhead;

	let preview: string;

	switch (contentType) {
		case 'json': {
			try {
				const parsed = JSON.parse(output.trim());
				if (Array.isArray(parsed)) {
					preview = summarizeJsonArray(parsed);
				} else if (typeof parsed === 'object' && parsed !== null) {
					preview = summarizeJsonObject(parsed as Record<string, unknown>);
				} else {
					preview = summarizeText(output, 3);
				}
			} catch {
				preview = summarizeText(output, 3);
			}
			break;
		}
		case 'code': {
			preview = summarizeCode(output);
			break;
		}
		case 'text': {
			preview = summarizeText(output, 5);
			break;
		}
		case 'binary': {
			preview = `[Binary content - ${formattedSize}]`;
			break;
		}
		default: {
			preview = summarizeText(output, 5);
		}
	}

	// Truncate preview if it exceeds max preview chars
	if (preview.length > maxPreviewChars) {
		preview = `${preview.substring(0, maxPreviewChars - 3)}...`;
	}

	return `${headerLine}\n${preview}\n${footerLine}`;
}

/**
 * Internal helpers exposed for testability.
 */
export const _internals = {
	jsonTypeSignature,
	summarizeJsonObject,
	summarizeJsonArray,
	extractCodeSignatures,
	summarizeCode,
	summarizeText,
};

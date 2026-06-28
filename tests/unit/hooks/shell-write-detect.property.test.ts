import { describe, expect, test } from 'bun:test';
import {
	detectPosixWrites,
	detectWindowsWrites,
} from '../../../src/hooks/shell-write-detect';

const DEFAULT_SEED = 0x5eed1275;
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

const POSIX_WRITE_CORPUS = [
	'echo hi > out.txt',
	'printf hi >> out.txt',
	'cat <<EOF > out.txt\nhello\nEOF',
	'cp src.txt dest.txt',
	'mv old.txt new.txt',
	'install src.bin /tmp/bin',
	'ln -s source linkname',
	'truncate -s 0 output.log',
	"sed -i 's/a/b/' file.txt",
	"perl -pi -e 's/a/b/' file.txt",
	"python -c \"open('out.txt', 'w').write('x')\"",
	"node -e \"require('fs').writeFileSync('out.txt', 'x')\"",
	'curl -o out.bin https://example.test/file',
	'wget -O out.bin https://example.test/file',
	'tar -xf archive.tar',
	'unzip archive.zip',
	'git reset --hard HEAD~1',
	'git clean -fd',
];

const POSIX_NO_CRASH_CORPUS = [
	'bash -c "echo hi > out.txt"',
	'sh -c "cp a b"',
	'tee >(cat > out.txt)',
	'echo "unterminated',
	'ｒｍ -ｒｆ .swarm',
	"printf '%s' hello > 'path with spaces.txt'",
	'cat <<EOF\nbody\nEOF',
	'git checkout -- file.txt',
];

const WINDOWS_WRITE_CORPUS: Array<{
	shell: 'powershell' | 'cmd';
	command: string;
}> = [
	{ shell: 'powershell', command: 'Set-Content out.txt value' },
	{ shell: 'powershell', command: 'Out-File out.txt' },
	{ shell: 'powershell', command: 'Copy-Item src.txt dest.txt' },
	{ shell: 'powershell', command: 'Move-Item src.txt dest.txt' },
	{ shell: 'powershell', command: 'Remove-Item old.txt' },
	{ shell: 'powershell', command: 'Invoke-WebRequest $url -OutFile out.bin' },
	{ shell: 'cmd', command: 'echo hello > out.txt' },
	{ shell: 'cmd', command: 'copy src.txt dest.txt' },
	{ shell: 'cmd', command: 'move src.txt dest.txt' },
	{ shell: 'cmd', command: 'del old.txt' },
];

const WINDOWS_NO_CRASH_CORPUS: Array<{
	shell: 'powershell' | 'cmd';
	command: string;
}> = [
	{ shell: 'powershell', command: 'powershell -EncodedCommand !!!!' },
	{ shell: 'powershell', command: 'Set-Content "unterminated' },
	{ shell: 'cmd', command: 'cmd /c "echo hello > out.txt"' },
	{ shell: 'cmd', command: 'rmdir /s "C:\\path with spaces\\target"' },
	{ shell: 'cmd', command: 'ＥＣＨＯ hi > out.txt' },
];

function mutatePosix(command: string, rng: () => number): string {
	switch (Math.floor(rng() * 4)) {
		case 0:
			return command.replaceAll(' ', pick(rng, ['  ', '\t', ' \t ']));
		case 1:
			return `${command} ${pick(rng, ['--', '# trailing comment', '|| true'])}`;
		case 2:
			return command.replace(/out\.txt|dest\.txt|file\.txt/, (m) => `'${m}'`);
		default:
			return command;
	}
}

function mutateWindows(command: string, rng: () => number): string {
	switch (Math.floor(rng() * 4)) {
		case 0:
			return command.replaceAll(' ', pick(rng, ['  ', '\t', ' \t ']));
		case 1:
			return command.replace(/out\.txt|dest\.txt|old\.txt/, (m) => `"${m}"`);
		case 2:
			return command.replace(/Copy-Item|Move-Item|Remove-Item/i, (m) =>
				pick(rng, [m, m.toUpperCase(), m.toLowerCase()]),
			);
		default:
			return command;
	}
}

function posixOraclePositive(command: string): boolean {
	return (
		/\s(?:>|>>)\s*['"]?[^'"\s]+/.test(command) ||
		/\b(cp|mv|install|ln|truncate)\b/.test(command) ||
		/\b(sed|perl)\s+[^|;&]*-[^\s]*i/.test(command) ||
		/\b(python|python3|node|bun|ruby|perl|php)\s+[^|;&]*-[cemr]\b/.test(
			command,
		) ||
		/\b(curl|wget)\s+[^|;&]*\s-[oO]\s+/.test(command) ||
		/\b(tar|unzip)\b/.test(command) ||
		/\bgit\s+(reset\s+--hard|clean\s+-[^\s]*[df])\b/.test(command)
	);
}

function windowsOraclePositive(command: string): boolean {
	return (
		/(?:^|\s)(>|>>)\s*"?[^"\s]+/.test(command) ||
		/\b(Set-Content|Out-File|Add-Content|Clear-Content|Copy-Item|Move-Item|Remove-Item|Invoke-WebRequest)\b/i.test(
			command,
		) ||
		/\b(copy|move|del)\b/i.test(command)
	);
}

describe('shell write detector property coverage', () => {
	test('POSIX detector never throws and does not miss conservative write oracle positives', () => {
		const rng = mulberry32(fuzzSeed());
		for (let i = 0; i < fuzzIterations(); i++) {
			const base = pick(rng, POSIX_WRITE_CORPUS);
			const command = mutatePosix(base, rng);
			const result = detectPosixWrites(command);
			if (posixOraclePositive(command)) {
				expect(result.hasWrites || result.parseError).toBe(true);
			}
		}
	});

	test('POSIX detector never throws on malformed, wrapped, or unicode-heavy commands', () => {
		const rng = mulberry32(fuzzSeed() ^ 0x9e3779b9);
		for (let i = 0; i < fuzzIterations(); i++) {
			const command = mutatePosix(pick(rng, POSIX_NO_CRASH_CORPUS), rng);
			expect(() => detectPosixWrites(command)).not.toThrow();
		}
	});

	test('Windows detector never throws and does not miss conservative write oracle positives', () => {
		const rng = mulberry32(fuzzSeed() ^ 0xa5a5a5a5);
		for (let i = 0; i < fuzzIterations(); i++) {
			const base = pick(rng, WINDOWS_WRITE_CORPUS);
			const command = mutateWindows(base.command, rng);
			const result = detectWindowsWrites(command, base.shell);
			if (windowsOraclePositive(command)) {
				if (!result.hasWrites) {
					throw new Error(
						`Windows write oracle miss for ${base.shell}: ${command}`,
					);
				}
			}
		}
	});

	test('Windows detector never throws on malformed, wrapped, or unicode-heavy commands', () => {
		const rng = mulberry32(fuzzSeed() ^ 0x51f15e);
		for (let i = 0; i < fuzzIterations(); i++) {
			const base = pick(rng, WINDOWS_NO_CRASH_CORPUS);
			const command = mutateWindows(base.command, rng);
			expect(() => detectWindowsWrites(command, base.shell)).not.toThrow();
		}
	});
});

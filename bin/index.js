#!/usr/bin/env node
import { Command } from 'commander';
import 'dotenv/config';
import inquirer from 'inquirer';
import { spawnSync } from 'node:child_process';


const DEFAULT_SERVER = "https://commitcoach-proxy.onrender.com";
const program = new Command()
  .name('commitcoach')
  .description('AI commit message helper')
  .option('-s, --style <style>', 'message style: conventional|casual|formal', 'conventional')
  .parse(process.argv);

function getStagedDiff() {
  const result = spawnSync(
    'git',
    ['diff', '--cached', '--no-color', '--unified=0'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 50, shell: false }
  );
  if (result.status !== 0) {
    const msg = result.stderr?.trim() || result.error?.message || 'git diff failed';
    throw new Error(msg);
  }
  const diff = result.stdout || '';
  if (!diff.trim()) throw new Error('No staged changes. Run `git add` first.');
  return diff;
}

function buildPrompt(style, diff) {
  const styleHint = {
    conventional: 'Use Conventional Commits. Start with feat/fix/docs/refactor/etc and a short scope.',
    casual: 'Friendly but clear, ~1 short sentence.',
    formal: 'Professional tone, concise summary first.'
  }[style] || 'Be clear and concise.';

  return `You are CommitCoach, an expert at writing excellent Git commit messages.

STYLE: ${style}
GUIDELINES:
- Single-line subject <= 72 chars
- Use imperative mood
- Be specific about the change and intent
- No code blocks, return plain text only

${styleHint}

Generate a commit message for the staged diff below.

DIFF START
${diff}
DIFF END`;
}

async function askAI(server, diff) {
  const res = await fetch(`${server}/v1/commitcoach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diff }) // backend expects { diff }
  });
  if (!res.ok) {
    throw new Error(`Proxy error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return (data.message || 'chore: update').trim();
}




function commitWithMessage(message) {
  const r = spawnSync('git', ['commit', '-q', '-m', message], {
    encoding: 'utf8', stdio: 'pipe'
  });
  if (r.status !== 0) {
    const msg = (r.stderr || 'git commit failed').toString().trim();
    throw new Error(msg);
  }
  const hash = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' })
    .stdout.trim();
  console.log(`✅ Committed ${hash}: ${message.split('\n')[0]}`);
}

async function confirmAndCommit(message) {
  const { action } = await inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: `Suggested commit message:\n\n${message}\n\nChoose:`,
    choices: [
      { name: '✅ Use as-is', value: 'use' },
      { name: '✏️  Edit message (type inline, press Enter to commit)', value: 'edit' },
      { name: '🔄 Regenerate', value: 'regen' },
      { name: '❌ Cancel', value: 'cancel' }
    ]
  }]);

  if (action === 'edit') {
    const { edited } = await inquirer.prompt([{
      type: 'input',
      name: 'edited',
      message: 'Type your commit subject and press Enter to commit:',
      default: message,
      filter: v => (v || message).trim()
    }]);
    commitWithMessage(edited);   // <-- commit immediately
    return 'done';               // <-- don't reopen the menu
  }

  if (action === 'regen') return 'regen';
  if (action === 'cancel') process.exit(0);

  // Use as-is
  commitWithMessage(message);
  return 'done';
}

(async () => {
//   const opts = program.opts();
  let diff = getStagedDiff();

  const HARD_LIMIT = 20_000;
  if (diff.length > HARD_LIMIT) diff = diff.slice(0, HARD_LIMIT) + '\n...[truncated]';

  while (true) {
    const msg = await askAI(DEFAULT_SERVER, diff);
    const res = await confirmAndCommit(msg);
    if (res !== 'regen') break;
  }
})();

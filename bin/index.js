#!/usr/bin/env node
import { Command } from 'commander';
import 'dotenv/config';
import inquirer from 'inquirer';
import { spawnSync } from 'node:child_process';

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

async function askAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.MODEL || 'gpt-4o-mini';
  if (!apiKey) {
    console.error('⚠️  Missing OPENAI_API_KEY in .env');
    process.exit(1);
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    })
  });
  if (!res.ok) {
    console.error('⚠️  OpenAI request failed:', await res.text());
    process.exit(1);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || 'chore: update';
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
  const opts = program.opts();
  let diff = getStagedDiff();

  // Defensive: clamp huge diffs (v0). v1 will chunk & summarize.
  const HARD_LIMIT = 20_000; // chars
  if (diff.length > HARD_LIMIT) diff = diff.slice(0, HARD_LIMIT) + '\n...[truncated]';

  while (true) {
    const prompt = buildPrompt(opts.style, diff);
    const msg = await askAI(prompt);
    const res = await confirmAndCommit(msg);
    if (res !== 'regen') break;
  }
})();

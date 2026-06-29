import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as api from '../src/index.js';

const SKILL_PATH = join(process.cwd(), 'skills', 'ffm-script', 'SKILL.md');
const skill = readFileSync(SKILL_PATH, 'utf8');

/** Splits the YAML frontmatter block from the markdown body. */
function frontmatter(text: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return match?.[1] ?? '';
}

describe('SKILL.md', () => {
  it('has name and description frontmatter', () => {
    const fm = frontmatter(skill);
    expect(fm).toMatch(/^name:\s*ffm-script\s*$/m);
    expect(fm).toMatch(/^description:\s*\S+/m);
  });

  // Guards against drift: every runtime export (operations, the chain class,
  // building blocks and error classes) must be documented in the skill, so a new
  // public symbol can't ship without the assistant learning about it.
  it('documents every public runtime export', () => {
    const exported = Object.keys(api).filter(
      (name) => typeof (api as Record<string, unknown>)[name] === 'function',
    );
    expect(exported.length).toBeGreaterThan(0);

    const missing = exported.filter((name) => !new RegExp(`\\b${name}\\b`).test(skill));
    expect(missing).toEqual([]);
  });
});

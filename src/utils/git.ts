import { execa } from 'execa';
import { readFileSync } from 'node:fs';
import ignore, { type Ignore } from 'ignore';

import { outro, spinner } from '@clack/prompts';

export async function assertGitRepo() {
  try {
    await execa('git', ['rev-parse']);
  } catch (error) {
    throw new Error(error as string);
  }
}

export function getOpenCommitIgnore(): Ignore {
  const ig = ignore();

  try {
    ig.add(readFileSync('.opencommitignore').toString().split('\n'));
  } catch {
    /* empty */
  }

  return ig;
}

export async function getCoreHooksPath(): Promise<string> {
  const { stdout } = await execa('git', ['config', 'core.hooksPath']);

  return stdout;
}

export async function getStagedFiles(): Promise<string[]> {
  const { stdout: gitDirectory } = await execa('git', ['rev-parse', '--show-toplevel']);

  const { stdout: files } = await execa('git', [
    'diff',
    '--name-only',
    '--cached',
    '--relative',
    gitDirectory
  ]);

  if (!files) return [];

  const filesList = files.split('\n');

  const ig = getOpenCommitIgnore();
  const allowedFiles = filesList.filter((file) => !ig.ignores(file));

  if (!allowedFiles) return [];

  return allowedFiles.sort((a, b) => a.localeCompare(b));
}

export async function getChangedFiles(): Promise<string[]> {
  const { stdout: modified } = await execa('git', ['ls-files', '--modified']);
  const { stdout: others } = await execa('git', ['ls-files', '--others', '--exclude-standard']);

  const files = [...modified.split('\n'), ...others.split('\n')].filter((file) => !!file);

  return files.sort((a, b) => a.localeCompare(b));
}

export async function gitAdd({ files }: { files: string[] }) {
  const gitAddSpinner = spinner();
  gitAddSpinner.start('Adding files to commit');
  await execa('git', ['add', ...files]);
  gitAddSpinner.stop('Done');
}

export async function getDiff({ files }: { files: string[] }) {
  const lockFiles = files.filter(
    (file) =>
      file.includes('.lock') ||
      file.includes('-lock.') ||
      file.includes('.svg') ||
      file.includes('.png') ||
      file.includes('.jpg') ||
      file.includes('.jpeg') ||
      file.includes('.webp') ||
      file.includes('.gif')
  );

  if (lockFiles.length > 0) {
    outro(
      `Some files are excluded by default from 'git diff'. No commit messages are generated for this files:\n${lockFiles.join('\n')}`
    );
  }

  const filesWithoutLocks = files.filter(
    (file) => !file.includes('.lock') && !file.includes('-lock.')
  );

  const { stdout: diff } = await execa('git', ['diff', '--staged', '--', ...filesWithoutLocks]);

  return diff;
}

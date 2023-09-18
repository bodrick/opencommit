import { readFileSync } from 'node:fs';

import { outro, spinner } from '@clack/prompts';
import { execa } from 'execa';
import ignore, { Ignore } from 'ignore';

/**
 * Asserts that the current directory is a valid Git repository.
 *
 * @return {Promise<void>} Throws an error if the current directory is not a Git repository.
 */
export async function assertGitRepo() {
  try {
    await execa('git', ['rev-parse']);
  } catch (error) {
    throw new Error(error as string);
  }
}

// const excludeBigFilesFromDiff = ['*-lock.*', '*.lock'].map(
//   (file) => `:(exclude)${file}`
// );

/**
 * Retrieves the open commit ignore configuration.
 *
 * @return {Ignore} The open commit ignore configuration.
 */
export function getOpenCommitIgnore(): Ignore {
  const ig = ignore();

  try {
    ig.add(readFileSync('.opencommitignore').toString().split('\n'));
  } catch {
    /* empty */
  }

  return ig;
}

/**
 * Retrieves the path to the core hooks directory.
 *
 * @return {Promise<string>} The path to the core hooks directory.
 */
export async function getCoreHooksPath(): Promise<string> {
  const { stdout } = await execa('git', ['config', 'core.hooksPath']);

  return stdout;
}

/**
 * Retrieves a list of staged files in the git repository.
 *
 * @return {Promise<string[]>} An array of strings representing the staged files.
 */
export async function getStagedFiles(): Promise<string[]> {
  const { stdout: gitDir } = await execa('git', [
    'rev-parse',
    '--show-toplevel'
  ]);

  const { stdout: files } = await execa('git', [
    'diff',
    '--name-only',
    '--cached',
    '--relative',
    gitDir
  ]);

  if (!files) return [];

  const filesList = files.split('\n');

  const ig = getOpenCommitIgnore();
  const allowedFiles = filesList.filter((file) => !ig.ignores(file));

  if (!allowedFiles) return [];

  return allowedFiles.sort((a, b) => a.localeCompare(b));
}

/**
 * Retrieves a list of changed files.
 *
 * @return {Promise<string[]>} An array of strings representing the file paths of the changed files.
 */
export async function getChangedFiles(): Promise<string[]> {
  const { stdout: modified } = await execa('git', ['ls-files', '--modified']);
  const { stdout: others } = await execa('git', [
    'ls-files',
    '--others',
    '--exclude-standard'
  ]);

  const files = [...modified.split('\n'), ...others.split('\n')].filter(
    (file) => !!file
  );

  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * Adds the specified files to the git commit.
 *
 * @param {string[]} files - The files to be added.
 * @return {Promise<void>} A promise that resolves when the files have been added.
 */
export async function gitAdd({ files }: { files: string[] }) {
  const gitAddSpinner = spinner();
  gitAddSpinner.start('Adding files to commit');
  await execa('git', ['add', ...files]);
  gitAddSpinner.stop('Done');
}

/**
 * Retrieves the difference between the staged changes and the current state of the files.
 *
 * @param {Object} options - The options object.
 * @param {string[]} options.files - An array of file paths.
 * @returns {Promise<string>} A promise that resolves with the diff between the staged changes and the current state of the files.
 */
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
      `Some files are excluded by default from 'git diff'. No commit messages are generated for this files:\n${lockFiles.join(
        '\n'
      )}`
    );
  }

  const filesWithoutLocks = files.filter(
    (file) => !file.includes('.lock') && !file.includes('-lock.')
  );

  const { stdout: diff } = await execa('git', [
    'diff',
    '--staged',
    '--',
    ...filesWithoutLocks
  ]);

  return diff;
}

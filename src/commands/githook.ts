import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { intro, outro } from '@clack/prompts';
import chalk from 'chalk';
import { command } from 'cleye';

import { COMMANDS } from '../CommandsEnum.js';
import { assertGitRepo, getCoreHooksPath } from '../utils/git.js';

const __filename = fileURLToPath(import.meta.url);
const HOOK_NAME = 'prepare-commit-msg';
const DEFAULT_SYMLINK_URL = path.join('.git', 'hooks', HOOK_NAME);

const getHooksPath = async (): Promise<string> => {
  try {
    const hooksPath = await getCoreHooksPath();
    return path.join(hooksPath, HOOK_NAME);
  } catch {
    return DEFAULT_SYMLINK_URL;
  }
};

export const isHookCalled = async (): Promise<boolean> => {
  const hooksPath = await getHooksPath();
  return process.argv[1].endsWith(hooksPath);
};

const isHookExists = async (): Promise<boolean> => {
  const hooksPath = await getHooksPath();
  return existsSync(hooksPath);
};

export const hookCommand = command(
  {
    name: COMMANDS.hook,
    parameters: ['<set/unset>']
  },
  async (argv) => {
    const HOOK_URL = __filename;
    const SYMLINK_URL = await getHooksPath();
    try {
      await assertGitRepo();

      const { setUnset: mode } = argv._;

      if (mode === 'set') {
        intro(`setting opencommit as '${HOOK_NAME}' hook at ${SYMLINK_URL}`);

        if (await isHookExists()) {
          let realPath;
          try {
            realPath = await fs.realpath(SYMLINK_URL);
          } catch (error) {
            outro(error as string);
            realPath = null;
          }

          if (realPath === HOOK_URL)
            return outro(`OpenCommit is already set as '${HOOK_NAME}'`);

          throw new Error(
            `Different ${HOOK_NAME} is already set. Remove it before setting opencommit as '${HOOK_NAME}' hook.`
          );
        }

        await fs.mkdir(path.dirname(SYMLINK_URL), { recursive: true });
        await fs.symlink(HOOK_URL, SYMLINK_URL, 'file');
        await fs.chmod(SYMLINK_URL, 0o755);

        return outro(`${chalk.green('✔')} Hook set`);
      }

      if (mode === 'unset') {
        intro(
          `unsetting opencommit as '${HOOK_NAME}' hook from ${SYMLINK_URL}`
        );

        if (!(await isHookExists())) {
          return outro(
            `OpenCommit wasn't previously set as '${HOOK_NAME}' hook, nothing to remove`
          );
        }

        const realpath = await fs.realpath(SYMLINK_URL);
        if (realpath !== HOOK_URL) {
          return outro(
            `OpenCommit wasn't previously set as '${HOOK_NAME}' hook, but different hook was, if you want to remove it — do it manually`
          );
        }

        await fs.rm(SYMLINK_URL);
        return outro(`${chalk.green('✔')} Hook is removed`);
      }

      throw new Error(
        `Unsupported mode: ${mode}. Supported modes are: 'set' or 'unset'`
      );
    } catch (error) {
      if (error instanceof Error) outro(`${chalk.red('✖')} ${error.message}`);
      process.exit(1);
    }
  }
);

import chalk from 'chalk';
import fs from 'node:fs/promises';

import { intro, outro, spinner } from '@clack/prompts';

import { generateCommitMessageByDiff } from '../generate-commit-message-from-git-diff';
import { getChangedFiles, getDiff, getStagedFiles, gitAdd } from '../utils/git';
import { getConfig } from './config';

const [messageFilePath, commitSource] = process.argv.slice(2);

export const prepareCommitMessageHook = async (isStageAllFlag = false) => {
  try {
    if (!messageFilePath) {
      throw new Error(
        'Commit message file path is missing. This file should be called from the "prepare-commit-msg" git hook'
      );
    }

    if (commitSource) return;

    if (isStageAllFlag) {
      const changedFiles = await getChangedFiles();

      if (changedFiles) await gitAdd({ files: changedFiles });
      else {
        outro('No changes detected, write some code and run `oco` again');
        process.exit(1);
      }
    }

    const staged = await getStagedFiles();

    if (!staged) return;

    intro('opencommit');

    const config = getConfig();

    if (!config?.OCO_OPENAI_API_KEY) {
      throw new Error('No OPEN_AI_API exists. Set your OPEN_AI_API=<key> in ~/.opencommit');
    }

    const spin = spinner();
    spin.start('Generating commit message');

    const commitMessage = await generateCommitMessageByDiff(await getDiff({ files: staged }));
    spin.stop('Done');

    const fileContent = await fs.readFile(messageFilePath);

    await fs.writeFile(messageFilePath, commitMessage + '\n' + fileContent.toString());
  } catch (error) {
    outro(`${chalk.red('✖')} ${error}`);
    process.exit(1);
  }
};

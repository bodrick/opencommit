import chalk from 'chalk';
import { execa } from 'execa';

import { confirm, intro, isCancel, multiselect, outro, select, spinner } from '@clack/prompts';

import { generateCommitMessageByDiff } from '../generate-commit-message-from-git-diff';
import { assertGitRepo, getChangedFiles, getDiff, getStagedFiles, gitAdd } from '../utils/git';
import { trytm } from '../utils/trytm';
import { getConfig } from './config';

const config = getConfig();

const getGitRemotes = async () => {
  const { stdout } = await execa('git', ['remote']);
  return stdout.split('\n').filter((remote) => Boolean(remote.trim()));
};

// Check for the presence of message templates
const checkMessageTemplate = (extraArguments: string[]): string | false => {
  for (const key in extraArguments) {
    if (extraArguments[key].includes(config?.OCO_MESSAGE_TEMPLATE_PLACEHOLDER))
      return extraArguments[key];
  }
  return false;
};

const generateCommitMessageFromGitDiff = async (
  diff: string,
  extraArguments: string[]
): Promise<void> => {
  await assertGitRepo();
  const commitSpinner = spinner();
  commitSpinner.start('Generating the commit message');

  try {
    let commitMessage = await generateCommitMessageByDiff(diff);

    const messageTemplate = checkMessageTemplate(extraArguments);
    if (config?.OCO_MESSAGE_TEMPLATE_PLACEHOLDER && typeof messageTemplate === 'string') {
      commitMessage = messageTemplate.replace(
        config?.OCO_MESSAGE_TEMPLATE_PLACEHOLDER,
        commitMessage
      );
    }

    commitSpinner.stop('📝 Commit message generated');

    outro(
      `Generated commit message:
${chalk.grey('——————————————————')}
${commitMessage}
${chalk.grey('——————————————————')}`
    );

    const isCommitConfirmedByUser = await confirm({
      message: 'Confirm the commit message?'
    });

    if (isCommitConfirmedByUser && !isCancel(isCommitConfirmedByUser)) {
      const { stdout } = await execa('git', ['commit', '-m', commitMessage, ...extraArguments]);

      outro(`${chalk.green('✔')} Successfully committed`);

      outro(stdout);

      const remotes = await getGitRemotes();

      if (remotes.length === 0) {
        const { stdout } = await execa('git', ['push']);
        if (stdout) outro(stdout);
        process.exit(0);
      }

      if (remotes.length === 1) {
        const isPushConfirmedByUser = await confirm({
          message: 'Do you want to run `git push`?'
        });

        if (isPushConfirmedByUser && !isCancel(isPushConfirmedByUser)) {
          const pushSpinner = spinner();

          pushSpinner.start(`Running 'git push ${remotes[0]}'`);

          const { stdout } = await execa('git', ['push', '--verbose', remotes[0]]);

          pushSpinner.stop(`${chalk.green('✔')} Successfully pushed all commits to ${remotes[0]}`);

          if (stdout) outro(stdout);
        } else {
          outro('`git push` aborted');
          process.exit(0);
        }
      } else {
        const selectedRemote = (await select({
          message: 'Choose a remote to push to',
          options: remotes.map((remote) => ({ label: remote, value: remote }))
        })) as string;

        if (isCancel(selectedRemote)) {
          outro(`${chalk.gray('✖')} process cancelled`);
        } else {
          const pushSpinner = spinner();

          pushSpinner.start(`Running 'git push ${selectedRemote}'`);

          const { stdout } = await execa('git', ['push', selectedRemote]);

          pushSpinner.stop(
            `${chalk.green('✔')} Successfully pushed all commits to ${selectedRemote}`
          );

          if (stdout) outro(stdout);
        }
      }
    }
  } catch (error) {
    commitSpinner.stop('📝 Commit message generated');

    if (error instanceof Error) {
      outro(`${chalk.red('✖')} ${error.message}`);
    } else {
      outro(`${chalk.red('✖')} ${error}`);
    }
    process.exit(1);
  }
};

export async function commit(extraArguments: string[] = [], isStageAllFlag = false) {
  if (isStageAllFlag) {
    const changedFiles = await getChangedFiles();

    if (changedFiles) await gitAdd({ files: changedFiles });
    else {
      outro('No changes detected, write some code and run `oco` again');
      process.exit(1);
    }
  }

  const [stagedFiles, errorStagedFiles] = await trytm(getStagedFiles());
  const [changedFiles, errorChangedFiles] = await trytm(getChangedFiles());

  if (!changedFiles?.length && !stagedFiles?.length) {
    outro(chalk.red('No changes detected'));
    process.exit(1);
  }

  intro('open-commit');
  if (errorChangedFiles ?? errorStagedFiles) {
    outro(`${chalk.red('✖')} ${errorChangedFiles ?? errorStagedFiles}`);
    process.exit(1);
  }

  const stagedFilesSpinner = spinner();

  stagedFilesSpinner.start('Counting staged files');

  if (stagedFiles.length === 0) {
    stagedFilesSpinner.stop('No files are staged');
    const isStageAllAndCommitConfirmedByUser = await confirm({
      message: 'Do you want to stage all files and generate commit message?'
    });

    if (isStageAllAndCommitConfirmedByUser && !isCancel(isStageAllAndCommitConfirmedByUser)) {
      await commit(extraArguments, true);
      process.exit(1);
    }

    if (stagedFiles.length === 0 && changedFiles.length > 0) {
      const files = (await multiselect({
        message: chalk.cyan('Select the files you want to add to the commit:'),
        options: changedFiles.map((file) => ({
          label: file,
          value: file
        }))
      })) as string[];

      if (isCancel(files)) process.exit(1);

      await gitAdd({ files });
    }

    await commit(extraArguments, false);
    process.exit(1);
  }

  const stagedFilesMessage = stagedFiles.map((file) => `  ${file}`).join('\n');
  stagedFilesSpinner.stop(`${stagedFiles.length} staged files:\n${stagedFilesMessage}`);

  const [, generateCommitError] = await trytm(
    generateCommitMessageFromGitDiff(await getDiff({ files: stagedFiles }), extraArguments)
  );

  if (generateCommitError) {
    outro(`${chalk.red('✖')} ${generateCommitError}`);
    process.exit(1);
  }

  process.exit(0);
}

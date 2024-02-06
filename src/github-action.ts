import { unlinkSync, writeFileSync } from 'node:fs';

import core from '@actions/core';
import exec from '@actions/exec';
import github from '@actions/github';
import { intro, outro } from '@clack/prompts';
import type { PushEvent } from '@octokit/webhooks-types';

import { generateCommitMessageByDiff } from './generate-commit-message-from-git-diff';
import { randomIntFromInterval } from './utils/random-int-from-interval';
import { sleep } from './utils/sleep';

// This should be a token with access to your repository scoped in as a secret.
// The YML workflow will need to set GITHUB_TOKEN with the GitHub Secret Token
// GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
// https://help.github.com/en/actions/automating-your-workflow-with-github-actions/authenticating-with-the-github_token#about-the-github_token-secret
const GITHUB_TOKEN = core.getInput('GITHUB_TOKEN');
const octokit = github.getOctokit(GITHUB_TOKEN);
const context = github.context;
const owner = context.repo.owner;
const repo = context.repo.repo;

async function getCommitDiff(commitSha: string) {
  const diffResponse = await octokit.request<string>('GET /repos/{owner}/{repo}/commits/{ref}', {
    headers: {
      Accept: 'application/vnd.github.v3.diff'
    },
    owner,
    ref: commitSha,
    repo
  });
  return { diff: diffResponse.data, sha: commitSha };
}

interface DiffAndSHA {
  sha: string;
  diff: string;
}

interface MessageAndSHA {
  sha: string;
  msg: string;
}

// send only 3-4 size chunks of diffs in steps,
// because openAI restricts "too many requests" at once with 429 error
async function improveMessagesInChunks(diffsAndSHAs: DiffAndSHA[]) {
  const chunkSize = diffsAndSHAs.length % 2 === 0 ? 4 : 3;
  outro(`Improving commit messages in chunks of ${chunkSize}.`);
  const improvePromises = diffsAndSHAs.map((commit) => generateCommitMessageByDiff(commit.diff));

  const improvedMessagesAndSHAs: MessageAndSHA[] = [];
  for (let step = 0; step < improvePromises.length; step += chunkSize) {
    const chunkOfPromises = improvePromises.slice(step, step + chunkSize);

    try {
      const chunkOfImprovedMessages = await Promise.all(chunkOfPromises);

      const chunkOfImprovedMessagesBySha = chunkOfImprovedMessages.map((improvedMessage, index) => {
        const total = improvedMessagesAndSHAs.length;
        const sha = diffsAndSHAs[total + index].sha;

        return { msg: improvedMessage, sha };
      });

      improvedMessagesAndSHAs.push(...chunkOfImprovedMessagesBySha);

      // sometimes openAI errors with 429 code (too many requests),
      // so lets sleep a bit
      const sleepFor = 1000 * randomIntFromInterval(1, 5) + 100 * randomIntFromInterval(1, 5);

      outro(`Improved ${chunkOfPromises.length} messages. Sleeping for ${sleepFor}`);

      await sleep(sleepFor);
    } catch (error) {
      outro(error as string);

      // if sleeping in try block still fails with 429,
      // openAI wants at least 1 minute before next request
      const sleepFor = 60_000 + 1000 * randomIntFromInterval(1, 5);
      outro(`Retrying after sleeping for ${sleepFor}`);
      await sleep(sleepFor);

      // go to previous step
      step -= chunkSize;
    }
  }

  return improvedMessagesAndSHAs;
}

const getDiffsBySHAs = async (SHAs: string[]) => {
  const diffPromises = SHAs.map((sha) => getCommitDiff(sha));

  const diffs = await Promise.all(diffPromises).catch((error) => {
    outro(`Error in Promise.all(getCommitDiffs(SHAs)): ${error}.`);
    throw error;
  });

  return diffs;
};

async function improveCommitMessages(
  commitsToImprove: { id: string; message: string }[]
): Promise<void> {
  if (commitsToImprove.length > 0) {
    outro(`Found ${commitsToImprove.length} commits to improve.`);
  } else {
    outro('No new commits found.');
    return;
  }

  outro('Fetching commit diffs by SHAs.');
  const commitSHAsToImprove = commitsToImprove.map((commit) => commit.id);
  const diffsWithSHAs = await getDiffsBySHAs(commitSHAsToImprove);
  outro('Done.');

  const improvedMessagesWithSHAs = await improveMessagesInChunks(diffsWithSHAs);

  console.log(`Improved ${improvedMessagesWithSHAs.length} commits:`, improvedMessagesWithSHAs);

  // Check if there are actually any changes in the commit messages
  const messagesChanged = improvedMessagesWithSHAs.some(
    ({ msg }, index) => msg !== commitsToImprove[index].message
  );

  if (!messagesChanged) {
    console.log('No changes in commit messages detected, skipping rebase');
    return;
  }

  const createCommitMessageFile = (message: string, index: number) =>
    writeFileSync(`./commit-${index}.txt`, message);
  for (const [index, { msg }] of improvedMessagesWithSHAs.entries())
    createCommitMessageFile(msg, index);

  writeFileSync(`./count.txt`, '0');

  writeFileSync(
    './rebase-exec.sh',
    `#!/bin/bash
    count=$(cat count.txt)
    git commit --amend -F commit-$count.txt
    echo $(( count + 1 )) > count.txt`
  );

  await exec.exec(`chmod +x ./rebase-exec.sh`);

  await exec.exec('git', ['rebase', `${commitsToImprove[0].id}^`, '--exec', './rebase-exec.sh'], {
    env: {
      GIT_COMMITTER_EMAIL: `${process.env['GITHUB_ACTOR']}@users.noreply.github.com`,
      GIT_COMMITTER_NAME: process.env['GITHUB_ACTOR']!,
      GIT_SEQUENCE_EDITOR: 'sed -i -e "s/^pick/reword/g"'
    }
  });

  const deleteCommitMessageFile = (index: number) => unlinkSync(`./commit-${index}.txt`);
  for (const [index] of commitsToImprove.entries()) deleteCommitMessageFile(index);

  unlinkSync('./count.txt');
  unlinkSync('./rebase-exec.sh');

  outro('Force pushing non-interactively rebased commits into remote.');

  await exec.exec('git', ['status']);

  // Force push the rebased commits
  await exec.exec('git', ['push', `--force`]);

  outro('Done 🧙');
}

async function run() {
  intro('OpenCommit — improving lame commit messages');

  try {
    if (github.context.eventName === 'push') {
      outro(`Processing commits in a Push event`);

      const payload = github.context.payload as PushEvent;

      const commits = payload.commits;

      // Set local Git user identity for future git history manipulations
      if (payload.pusher.email)
        await exec.exec('git', ['config', 'user.email', payload.pusher.email]);

      await exec.exec('git', ['config', 'user.name', payload.pusher.name]);

      await exec.exec('git', ['status']);
      await exec.exec('git', ['log', '--oneline']);

      await improveCommitMessages(commits);
    } else {
      outro('Wrong action.');
      core.error(
        `OpenCommit was called on ${github.context.payload.action}. OpenCommit is supposed to be used on "push" action.`
      );
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else if (typeof error === 'string') {
      core.setFailed(error);
    } else {
      core.setFailed('Unknown error');
    }
  }
}

// eslint-disable-next-line unicorn/prefer-top-level-await
(async () => {
  try {
    await run();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();

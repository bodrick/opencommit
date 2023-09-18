import { unlinkSync, writeFileSync } from 'node:fs';

import core from '@actions/core';
import exec from '@actions/exec';
import github from '@actions/github';
import { intro, outro } from '@clack/prompts';
import { PushEvent } from '@octokit/webhooks-types';

import { generateCommitMessageByDiff } from './generateCommitMessageFromGitDiff';
import { randomIntFromInterval } from './utils/randomIntFromInterval';
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

type SHA = string;
type Diff = string;

/**
 * Retrieves the difference between the specified commit and its parent commit.
 *
 * @param {string} commitSha - The SHA of the commit.
 * @return {Promise<{ sha: string, diff: string }>} - A promise that resolves to an object containing the SHA of the commit and the diff.
 */
async function getCommitDiff(commitSha: string) {
  const diffResponse = await octokit.request<string>(
    'GET /repos/{owner}/{repo}/commits/{ref}',
    {
      owner,
      repo,
      ref: commitSha,
      headers: {
        Accept: 'application/vnd.github.v3.diff'
      }
    }
  );
  return { sha: commitSha, diff: diffResponse.data as string };
}

interface DiffAndSHA {
  sha: SHA;
  diff: Diff;
}

interface MsgAndSHA {
  sha: SHA;
  msg: string;
}

/**
 * Processes an array of diffs and SHA hashes in chunks to improve commit messages.
 * Sends only 3-4 size chunks of diffs in steps, because openAI restricts "too many requests" at once with 429 error
 *
 * @param {DiffAndSHA[]} diffsAndSHAs - An array of diffs and SHA hashes.
 * @return {Promise<MsgAndSHA[]>} - A promise that resolves to an array of improved commit messages and SHA hashes.
 */
async function improveMessagesInChunks(diffsAndSHAs: DiffAndSHA[]) {
  const chunkSize = diffsAndSHAs.length % 2 === 0 ? 4 : 3;
  outro(`Improving commit messages in chunks of ${chunkSize}.`);
  const improvePromises = diffsAndSHAs.map((commit) =>
    generateCommitMessageByDiff(commit.diff)
  );

  const improvedMessagesAndSHAs: MsgAndSHA[] = [];
  for (let step = 0; step < improvePromises.length; step += chunkSize) {
    const chunkOfPromises = improvePromises.slice(step, step + chunkSize);

    try {
      const chunkOfImprovedMessages = await Promise.all(chunkOfPromises);

      const chunkOfImprovedMessagesBySha = chunkOfImprovedMessages.map(
        (improvedMsg, i) => {
          const index = improvedMessagesAndSHAs.length;
          const sha = diffsAndSHAs[index + i].sha;

          return { sha, msg: improvedMsg };
        }
      );

      improvedMessagesAndSHAs.push(...chunkOfImprovedMessagesBySha);

      // sometimes openAI errors with 429 code (too many requests),
      // so lets sleep a bit
      const sleepFor =
        1000 * randomIntFromInterval(1, 5) + 100 * randomIntFromInterval(1, 5);

      outro(
        `Improved ${chunkOfPromises.length} messages. Sleeping for ${sleepFor}`
      );

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

/**
 * Retrieves the commit diffs for the given array of SHAs.
 *
 * @param {string[]} SHAs - An array of commit SHAs.
 * @return {Promise<any[]>} A Promise that resolves to an array of commit diffs.
 */
async function getDiffsBySHAs(SHAs: string[]) {
  const diffPromises = SHAs.map((sha) => getCommitDiff(sha));

  const diffs = await Promise.all(diffPromises).catch((error) => {
    outro(`Error in Promise.all(getCommitDiffs(SHAs)): ${error}.`);
    throw error;
  });

  return diffs;
}

/**
 * Improves commit messages for a given list of commits.
 *
 * @param {Array<{ id: string; message: string }>} commitsToImprove - The list of commits to improve.
 * @return {Promise<void>} A promise that resolves when the commit messages have been improved.
 */
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

  console.info(
    `Improved ${improvedMessagesWithSHAs.length} commits:`,
    improvedMessagesWithSHAs
  );

  // Check if there are actually any changes in the commit messages
  const messagesChanged = improvedMessagesWithSHAs.some(
    ({ msg }, index) => msg !== commitsToImprove[index].message
  );

  if (!messagesChanged) {
    console.info('No changes in commit messages detected, skipping rebase');
    return;
  }

  for (const [index, { msg: message }] of improvedMessagesWithSHAs.entries()) {
    writeFileSync(`./commit-${index}.txt`, message);
  }

  writeFileSync(`./count.txt`, '0');

  writeFileSync(
    './rebase-exec.sh',
    `#!/bin/bash
    count=$(cat count.txt)
    git commit --amend -F commit-$count.txt
    echo $(( count + 1 )) > count.txt`
  );

  await exec.exec(`chmod +x ./rebase-exec.sh`);

  await exec.exec(
    'git',
    ['rebase', `${commitsToImprove[0].id}^`, '--exec', './rebase-exec.sh'],
    {
      env: {
        GIT_SEQUENCE_EDITOR: 'sed -i -e "s/^pick/reword/g"',
        GIT_COMMITTER_NAME: process.env.GITHUB_ACTOR!,
        GIT_COMMITTER_EMAIL: `${process.env.GITHUB_ACTOR}@users.noreply.github.com`
      }
    }
  );

  for (const [index] of commitsToImprove.entries()) {
    unlinkSync(`./commit-${index}.txt`);
  }

  unlinkSync('./count.txt');
  unlinkSync('./rebase-exec.sh');

  outro('Force pushing non-interactively rebased commits into remote.');

  await exec.exec('git', ['status']);

  // Force push the rebased commits
  await exec.exec('git', ['push', `--force`]);

  outro('Done 🧙');
}

/**
 * Runs the main logic of the program.
 *
 * @return {Promise<void>} Promise that resolves when the function completes.
 */
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
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

await run();

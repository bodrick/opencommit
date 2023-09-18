import { note } from '@clack/prompts';
import OpenAI from 'openai';

import { getConfig } from './commands/config';
import { i18n, I18nLocals } from './i18n';
import { configureCommitlintIntegration } from './modules/commitlint/config';
import { commitlintPrompts } from './modules/commitlint/prompts';
import { ConsistencyPrompt } from './modules/commitlint/types';
import * as utils from './modules/commitlint/utils';

const config = getConfig();
const translation = i18n[(config?.OCO_LANGUAGE as I18nLocals) || 'en'];

export const IDENTITY =
  'You are to act as the author of a commit message in git.';

const INIT_MAIN_PROMPT = (
  language: string
): OpenAI.Chat.ChatCompletionMessageParam => ({
  role: 'system',
  content: `${IDENTITY} Your mission is to create clean and comprehensive commit messages as per the conventional commit convention and explain WHAT were the changes and mainly WHY the changes were done. I'll send you an output of 'git diff --staged' command, and you are to convert it into a commit message.
    ${
      config?.OCO_EMOJI
        ? 'Use GitMoji convention to preface the commit.'
        : 'Do not preface the commit with anything.'
    }
    ${
      config?.OCO_DESCRIPTION
        ? 'Add a short description of WHY the changes are done after the commit message. Don\'t start it with "This commit", just describe the changes.'
        : "Don't add any descriptions to the commit, only commit message."
    }
    Use the present tense. Lines must not be longer than 74 characters. Use ${language} for the commit message.`
});

export const INIT_DIFF_PROMPT: OpenAI.Chat.ChatCompletionMessageParam = {
  role: 'user',
  content: `diff --git a/src/server.ts b/src/server.ts
    index ad4db42..f3b18a9 100644
    --- a/src/server.ts
    +++ b/src/server.ts
    @@ -10,7 +10,7 @@
    import {
        initWinstonLogger();
        
        const app = express();
        -const port = 7799;
        +const PORT = 7799;
        
        app.use(express.json());
        
        @@ -34,6 +34,6 @@
        app.use((_, res, next) => {
            // ROUTES
            app.use(PROTECTED_ROUTER_URL, protectedRouter);
            
            -app.listen(port, () => {
                -  console.log(\`Server listening on port \${port}\`);
                +app.listen(process.env.PORT || PORT, () => {
                    +  console.log(\`Server listening on port \${PORT}\`);
                });`
};

const INIT_CONSISTENCY_PROMPT = (
  translation: ConsistencyPrompt
): OpenAI.Chat.ChatCompletionMessageParam => ({
  role: 'assistant',
  content: `${config?.OCO_EMOJI ? '🐛 ' : ''}${translation.commitFix}
${config?.OCO_EMOJI ? '✨ ' : ''}${translation.commitFeat}
${config?.OCO_DESCRIPTION ? translation.commitDescription : ''}`
});

export const getMainCommitPrompt = async (): Promise<
  OpenAI.Chat.ChatCompletionMessageParam[]
> => {
  switch (config?.OCO_PROMPT_MODULE) {
    case '@commitlint': {
      if (!(await utils.commitlintLLMConfigExists())) {
        note(
          `OCO_PROMPT_MODULE is @commitlint but you haven't generated consistency for this project yet.`
        );
        await configureCommitlintIntegration();
      }

      // Replace example prompt with a prompt that's generated by OpenAI for the commitlint config.
      const commitLintConfig = await utils.getCommitlintLLMConfig();

      return [
        commitlintPrompts.INIT_MAIN_PROMPT(
          translation.localLanguage,
          commitLintConfig.prompts
        ),
        INIT_DIFF_PROMPT,
        INIT_CONSISTENCY_PROMPT(
          commitLintConfig.consistency[translation.localLanguage]
        )
      ];
    }

    default: {
      // conventional-commit
      return [
        INIT_MAIN_PROMPT(translation.localLanguage),
        INIT_DIFF_PROMPT,
        INIT_CONSISTENCY_PROMPT(translation)
      ];
    }
  }
};

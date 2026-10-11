import { usePrinter } from 'ohnejs';
import { isUndefined, relativePath } from 'ohnejs/utils';
import { defineCommand } from 'ohnejs/utils/cli';
import { writeFileIfChanged } from 'ohnejs/utils/fs';

import { cmsTypesPath } from '../src/config.ts';
import { reportDegraded, siteTypes, siteTypesPath } from '../src/types/site-types.ts';

/**
 * The `ohne cms types` command: it writes the website types to `--out` or `cms.types`, else prints them.
 */
const types = defineCommand({
  meta: {
    name: 'types',
    description: 'Write the types your website imports.',
  },
  args: {
    out: { type: 'string', description: 'The file to write, instead of `cms.types`.' },
  },
  async run({ values }) {
    const out = values.out ?? cmsTypesPath();
    const { text, degraded } = await siteTypes();
    reportDegraded(degraded);
    if (isUndefined(out)) {
      process.stdout.write(text);
      return;
    }
    const path = siteTypesPath(out);
    const shown = relativePath(process.cwd(), path);
    const wrote = await writeFileIfChanged(path, text);
    usePrinter().success(wrote ? `Wrote \`${shown}\`` : `\`${shown}\` is current`);
  },
});

/**
 * The `ohne cms` command, which groups upkeep of the cms layer.
 */
export default defineCommand({
  meta: {
    name: 'cms',
    description: 'Maintain the cms layer.',
  },
  subCommands: { types },
});

#!/usr/bin/env node
/**
 * Copyright 2021 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */


/**
 * @fileoverview Renders symbol data for a specific Chrome APIs bundle generated with the "prepare"
 * script. This is used as part of the process to generate version data over time.
 *
 * TODO: this is only used by "prepare-history.js", perhaps it could be merged.
 */


import getStdin from 'get-stdin';
import * as chromeTypes from '../types/chrome.js';
import mri from 'mri';
import { RenderContext } from './lib/render-context.js';
import { FeatureQueryAll, RenderOverride } from './override.js';
import log from 'fancy-log';


async function run() {
  const argv = mri(process.argv.slice(2), {
    boolean: ['help', 'all'],
    alias: {
      'help': ['h'],
      'all': ['a'],
    },
    unknown: (v) => {
      throw new Error(`unexpected flag: ${v}`);
    },
  });

  if (argv.help || argv._.length !== 0) {
    console.warn(`Usage: cat apis.json | render-symbols.js > out.json

Prepares a JSON payload containing all symbols and their channel, based on the
JSON payload generated by "prepare.js". Renders the generated file to stdout.
This is used internally to generate historic version data for Chrome's APIs.
`);
    process.exit(0);
  }

  /** @type {chromeTypes.ProcessedAPIData} */
  const o = JSON.parse(await getStdin());

  const fq = new FeatureQueryAll(o.feature);
  const renderOverride = new RenderOverride(o.api, fq);
  const renderContext = new RenderContext(renderOverride);

  /** @type {Map<string, chromeTypes.TypeSpec>} */
  const symbols = new Map();

  renderContext.addCallback((spec, id) => {
    if (symbols.has(id)) {
      throw new Error(`got dup symbol: ${id}`);
    }

    // This should never happen: void symbols shouldn't be passed here (and only exist as return
    // values anyway).
    if (spec.type === 'void') {
      throw new Error(`got void`);
    }

    symbols.set(id, spec);
  });

  renderContext.renderAll(Object.values(o.api));

  const keys = [...symbols.keys()];
  keys.sort((a, b) => {
    if (a < b) {
      return -1;
    } else if (a > b) {
      return +1;
    }
    return 0;
  });

  /** @type {chromeTypes.ReleaseSymbolsData} */
  const out = {};

  let deprecatedCount = 0;
  let skipCount = 0;

  for (const [id, spec] of symbols) {
    // This generates override tags, but doesn't include e.g., deprecated which comes from the spec.
    const tags = renderOverride.completeTagsFor(spec, id);
    const channel = /** @type {chromeTypes.Channel|undefined} */ (tags.find(({ name }) => name === 'chrome-channel')?.value);

    // Only add a symbol if it's in the stable channel, so we can look at historic changes. Only
    // mark deprecated, so we can determine when that happened.
    // We don't include beta/dev etc symbols: that data is already obvious when generating the
    // definitions file.
    if (!channel || channel === 'stable') {
      out[id] = {};

      if (spec.deprecated) {
        out[id].deprecated = true;
        ++deprecatedCount;
      }
    } else {
      ++skipCount;
    }
  }

  log.warn(`Found ${Object.keys(out).length} stable symbols (${deprecatedCount} deprecated, ${skipCount} skipped) at ${o.definitionsRevision}`);
  process.stdout.write(JSON.stringify(out, undefined, 2));
}


await run();
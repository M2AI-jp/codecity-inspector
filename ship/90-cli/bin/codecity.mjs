#!/usr/bin/env node

import { main } from '../index.mjs';

const exitCode = await main();
process.exitCode = exitCode;

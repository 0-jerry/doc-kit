#!/usr/bin/env node
import { run } from './main.js'

process.exitCode = run(process.argv.slice(2))

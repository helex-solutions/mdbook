#!/usr/bin/env node
// mdbook CLI — build / dev a Markdown site from a project's .mdbook config.
import path from 'node:path'
import process from 'node:process'
import { buildSite, devSite } from '../src/build.mjs'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--project' || a === '-p') args.project = argv[++i]
    else if (a === '--out' || a === '-o') args.out = argv[++i]
    else if (a === '--base') args.base = argv[++i]
    else if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--host') {
      // `--host` binds all interfaces; `--host <addr>` binds a specific one.
      args.host = argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : true
    } else if (a === '--help' || a === '-h') args.help = true
    else args._.push(a)
  }
  return args
}

const HELP = `mdbook — Markdown + metadata static site generator

Usage:
  mdbook build [--project <dir>] [--out <dir>]
  mdbook dev   [--project <dir>] [--port <n>] [--host [addr]]

Options:
  -p, --project <dir>   Project root containing .mdbook/ (default: cwd)
  -o, --out <dir>       Output directory (default: .mdbook/dist)
      --base <path>     Base path (auto-detected from GITHUB_REPOSITORY in CI)
      --port <n>        Dev server port (default: 5173)
      --host [addr]     Expose the dev server on the network (bind all/<addr>)
  -h, --help            Show this help
`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0] || 'build'
  if (args.help || cmd === 'help') {
    console.log(HELP)
    return
  }
  const projectRoot = path.resolve(args.project || process.cwd())
  const overrides = {}
  if (args.out) overrides.out = args.out
  if (args.base) overrides.base = args.base
  if (args.port) overrides.port = args.port
  if (args.host !== undefined) overrides.host = args.host

  if (cmd === 'build') {
    await buildSite(projectRoot, overrides)
  } else if (cmd === 'dev') {
    await devSite(projectRoot, overrides)
  } else {
    console.error(`Unknown command: ${cmd}\n`)
    console.log(HELP)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
